// Where the acceptance scenario runs (step 3.11): SOTTO_ACCEPTANCE_TARGET picks localnet (the default,
// the CI's localnet job: the bootstrapped validator, the local faucet, the seeded E2E admin and the
// e2e server's log) or devnet (pnpm acceptance:devnet, scripts/acceptance-devnet.ts: the running
// devnet app and worker, fresh keypairs that wallet A funded before the run, a run admin seeded
// through ADMIN_WALLETS, the services' logs). Devnet amounts are small, so wallet A's devnet USDC
// lasts several runs, and each amount and memo of the scenario stays a unique string for I-2. Step 4.3:
// SOTTO_ACCEPTANCE_ASSET (or the spec) picks the organization's asset, USDC by default or devUSD; on
// localnet a devUSD owner's devUSD comes from the ledger's devUSD mint authority, as the devnet faucet's
// would. Devnet runs devUSD once it exists there (D-29).
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { createDb } from "@sotto/db";
import { getClusterConfig, GENESIS_HASHES, type AvailableClusterConfig } from "@sotto/sdk/cluster";
import { ASSET_WORDS, type AssetId } from "@sotto/sdk/cluster/assets";
import { associatedTokenAccount } from "@sotto/sdk/confidential/public";
import {
  fundLocalnetWallet,
  mintLocalnetDevusd,
  readLocalnetBootstrap,
} from "@sotto/sdk/testing/localnet";
import { createRetryingRpc, type SolanaRpc } from "@sotto/sdk/tx";
import type { Address } from "@solana/kit";
import { sql } from "drizzle-orm";
import { e2eKeypair, seededKeypair } from "./fixtures.ts";

type Line = { net: bigint; tax: bigint };

export type AcceptanceTarget = {
  name: "localnet" | "devnet";
  /** The organization's asset and its words (step 4.3). */
  asset: { id: AssetId } & (typeof ASSET_WORDS)[AssetId];
  rpc: SolanaRpc;
  /** The asset's wrapped mint, the owner's and the recipients' accounts' mint. */
  wrappedMint: Address;
  sasCredential: Address;
  sottoProofsProgram: Address;
  legalName: string;
  owner: number[];
  people: number[][];
  accountant: number[];
  admin: number[];
  /** The owner's deposit in whole USDC, public onchain by design (I-2 exempts it). */
  funding: bigint;
  /** Net and tax per payroll line, in base units: each a unique string, never a deposit. */
  lines: Line[];
  /** The proof of funds threshold as typed, and the statement the public page shows for it. */
  proofDollars: string;
  statement: string;
  /** A wallet's public account of the asset, funded here on localnet (SOL and whole units). */
  prepare(wallet: Address, sol: bigint, whole: bigint): Promise<Address>;
  /** The server side log lines written since the run began. */
  serverLog(): Promise<string>;
  /**
   * Every row of every table of the app's database as JSON, for I-2 (devnet; the localnet run's
   * database is the e2e server's own, created and dropped with it): null where not read.
   */
  databaseText(): Promise<string | null>;
  /** Where a passed run's screenshots go, and whether only the eight step shots go there. */
  shotsDir(stamp: string): string;
  stepShotsOnly: boolean;
  /** The screens are compared with their baselines (localnet only: devnet shows other data). */
  visual: boolean;
  /** Time limits grow on devnet, whose transactions finalize in seconds, not milliseconds. */
  slow: number;
  /** Writes what the run produced for the checks after it (devnet: result.json in the run folder). */
  record(result: Record<string, unknown>): Promise<void>;
};

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const LOCALNET_LINES: Line[] = [
  { net: 1_937_153n, tax: 484_288n },
  { net: 2_604_179n, tax: 651_044n },
  { net: 3_259_187n, tax: 814_796n },
];
const DEVNET_LINES: Line[] = [
  { net: 113_715n, tax: 148_428n },
  { net: 120_417n, tax: 165_104n },
  { net: 135_918n, tax: 181_479n },
];

/** The size of each file now, so the run reads only what was written after it began. */
async function sizes(paths: readonly string[]): Promise<number[]> {
  return Promise.all(paths.map(async (path) => (await stat(path).catch(() => null))?.size ?? 0));
}

async function readFrom(paths: readonly string[], offsets: readonly number[]): Promise<string> {
  const texts = await Promise.all(
    paths.map(async (path, index) => (await readFile(path)).subarray(offsets[index]).toString()),
  );
  return texts.join("\n");
}

async function localnet(assetId: AssetId): Promise<AcceptanceTarget> {
  const bootstrap = readLocalnetBootstrap();
  const rpc = createRetryingRpc(bootstrap.rpcUrl);
  const devusd = assetId === "devusd" ? bootstrap.devusd : null;
  if (assetId === "devusd" && !devusd) throw new Error("this ledger has no devUSD");
  const proofs = devusd ? devusd.sottoProofs : bootstrap.sottoProofs;
  if (!proofs) throw new Error("sotto_proofs is not deployed on this ledger");
  const log = join(ROOT, ".localnet/e2e-server.log");
  // Each asset's run has its own wallets: a wallet owns at most one organization.
  const tag = devusd ? "acceptance-devusd" : "acceptance";
  return {
    name: "localnet",
    asset: { id: assetId, ...ASSET_WORDS[assetId] },
    rpc,
    wrappedMint: devusd ? devusd.wrappedMint : bootstrap.wrappedUsdcMint,
    sasCredential: bootstrap.sas.credential,
    sottoProofsProgram: proofs.programId,
    legalName: devusd ? "Acceptance Dollar Test Ltd" : "Acceptance Test Ltd",
    owner: seededKeypair(`sotto-e2e-${tag}-owner/v1`).keypair,
    people: [1, 2, 3].map((n) => seededKeypair(`sotto-e2e-${tag}-person-${n}/v1`).keypair),
    accountant: seededKeypair(`sotto-e2e-${tag}-accountant/v1`).keypair,
    admin: e2eKeypair(),
    funding: 40n,
    lines: LOCALNET_LINES,
    proofDollars: "10",
    statement: devusd ? "Balance is at least 10 devUSD" : "Balance is at least $10",
    prepare: async (wallet, sol, whole) => {
      // SOL for the fees and the asset: USDC from the local USDC mint, devUSD from devUSD's.
      const funded = await fundLocalnetWallet(rpc, bootstrap, wallet, {
        sol,
        usdc: devusd ? 0n : whole,
      });
      return devusd ? mintLocalnetDevusd(rpc, bootstrap, wallet, whole) : funded.usdc;
    },
    // The e2e server writes its log for this run only (tests/e2e/server.ts).
    serverLog: () => readFile(log, "utf8"),
    databaseText: async () => null,
    shotsDir: (stamp) => join(ROOT, ".demo-shots", devusd ? `${stamp}-devusd` : stamp),
    stepShotsOnly: false,
    // The approved screens' baselines show USDC; the devUSD run checks its words instead.
    visual: !devusd,
    slow: 1,
    record: async () => {},
  };
}

async function devnet(assetId: AssetId): Promise<AcceptanceTarget> {
  const dir = process.env.SOTTO_DEVNET_ACCEPTANCE_DIR;
  if (!dir) throw new Error("SOTTO_DEVNET_ACCEPTANCE_DIR is not set: run pnpm acceptance:devnet");
  const cluster = getClusterConfig("devnet") as AvailableClusterConfig;
  if (!cluster.usdcMint || !cluster.wrappedUsdcMint || !cluster.sasCredential) {
    throw new Error("the devnet cluster config has no USDC, wrapped mint or SAS credential");
  }
  if (!cluster.sottoProofs) throw new Error("the devnet cluster config has no sotto_proofs");
  // The RPC endpoint from the worker's env file, never printed (ENGINEERING-RULES.md, local configuration).
  const env = parseEnv(await readFile(join(ROOT, "apps/worker/.env.local"), "utf8"));
  if (!env.RPC_URL) throw new Error("apps/worker/.env.local has no RPC_URL");
  const rpc = createRetryingRpc(env.RPC_URL);
  if ((await rpc.getGenesisHash().send()) !== GENESIS_HASHES.devnet) {
    throw new Error("the RPC_URL of apps/worker/.env.local does not serve devnet; refused");
  }
  const keypair = async (name: string) =>
    JSON.parse(await readFile(join(dir, `${name}.json`), "utf8")) as number[];
  const run = JSON.parse(await readFile(join(dir, "run.json"), "utf8")) as {
    stamp: string;
    legalName: string;
  };
  // The asset's mints and its own sotto_proofs deployment (step 4.3: devUSD from the registry).
  const devusd =
    assetId === "devusd" ? cluster.assets.find((entry) => entry.id === "devusd") : null;
  if (assetId === "devusd" && !devusd?.sottoProofs) {
    throw new Error("the devnet registry has no devUSD with its sotto_proofs");
  }
  const baseMint = devusd ? devusd.baseMint : cluster.usdcMint;
  // The running services' logs (14 section 2: .localnet/devnet-run/), from this point on.
  const logs = [".localnet/devnet-run/web.log", ".localnet/devnet-run/worker.log"].map((path) =>
    join(ROOT, path),
  );
  const offsets = await sizes(logs);
  return {
    name: "devnet",
    asset: { id: assetId, ...ASSET_WORDS[assetId] },
    rpc,
    wrappedMint: devusd ? devusd.wrappedMint : cluster.wrappedUsdcMint,
    sasCredential: cluster.sasCredential,
    sottoProofsProgram: devusd?.sottoProofs
      ? devusd.sottoProofs.program
      : cluster.sottoProofs.program,
    legalName: run.legalName,
    owner: await keypair("owner"),
    people: await Promise.all([1, 2, 3].map((n) => keypair(`person-${n}`))),
    accountant: await keypair("accountant"),
    admin: await keypair("admin"),
    funding: 1n,
    lines: DEVNET_LINES,
    proofDollars: "0.5",
    statement: devusd ? "Balance is at least 0.50 devUSD" : "Balance is at least $0.50",
    // Funded before the run (scripts/acceptance-devnet.ts: USDC from wallet A, devUSD from the
    // operator's mint on the server); here only its address.
    prepare: (wallet) => associatedTokenAccount(wallet, baseMint, TOKEN_PROGRAM_ADDRESS),
    serverLog: () => readFrom(logs, offsets),
    databaseText: async () => {
      // The app's own database, from its env file; the URL is never printed.
      const web = parseEnv(await readFile(join(ROOT, "apps/web/.env.local"), "utf8"));
      if (!web.DATABASE_URL) throw new Error("apps/web/.env.local has no DATABASE_URL");
      const client = createDb(web.DATABASE_URL, { max: 1 });
      try {
        const tables = await client.db.execute<{ name: string }>(
          sql`select table_name as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
        );
        const rows: string[] = [];
        for (const { name } of tables) {
          const result = await client.db.execute<{ row: string }>(
            sql`select row_to_json(t)::text as row from ${sql.identifier(name)} t`,
          );
          for (const { row } of result) rows.push(row);
        }
        return rows.join("\n");
      } finally {
        await client.close();
      }
    },
    shotsDir: (stamp) =>
      join(ROOT, ".demo-shots/devnet-acceptance", devusd ? `${stamp}-devusd` : stamp),
    stepShotsOnly: true,
    visual: false,
    slow: 3,
    record: async (result) => {
      await writeFile(join(dir, "result.json"), `${JSON.stringify(result, null, 2)}\n`, {
        mode: 0o600,
      });
    },
  };
}

export function acceptanceTarget(
  assetId: AssetId = process.env.SOTTO_ACCEPTANCE_ASSET === "devusd" ? "devusd" : "usdc",
): Promise<AcceptanceTarget> {
  return process.env.SOTTO_ACCEPTANCE_TARGET === "devnet" ? devnet(assetId) : localnet(assetId);
}
