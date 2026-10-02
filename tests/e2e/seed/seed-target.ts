// Where the demo seed runs (step 4.3): SOTTO_SEED_TARGET picks localnet (the default: the dry run on the
// bootstrapped validator with the e2e server, fixed seeded wallets, SOL from the local faucet and devUSD
// from the ledger's devUSD mint authority) or devnet (the live seed against the hosted app, only after
// the founder approved the live plan: keypairs from SOTTO_SEED_DIR, funded before the run, devUSD in
// the devnet registry). Every record goes through the app's own paths in the browser.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { getClusterConfig, GENESIS_HASHES } from "@sotto/sdk/cluster";
import {
  fundLocalnetWallet,
  mintLocalnetDevusd,
  readLocalnetBootstrap,
} from "@sotto/sdk/testing/localnet";
import { createRetryingRpc, type SolanaRpc } from "@sotto/sdk/tx";
import type { Address } from "@solana/kit";
import { e2eKeypair, seededKeypair } from "../fixtures.ts";

export type SeedTarget = {
  name: "localnet" | "devnet";
  rpc: SolanaRpc;
  /** The devUSD wrapped mint and its sotto_proofs deployment. */
  wrappedMint: Address;
  sottoProofsProgram: Address;
  keypair(key: string): Promise<number[]>;
  /** A Sotto admin's keypair, which approves the organization. */
  admin(): Promise<number[]>;
  /** Localnet: SOL from the local faucet and whole devUSD from the mint authority. Devnet: nothing. */
  prepare(wallet: Address, sol: bigint, devusd: bigint): Promise<void>;
  record(result: Record<string, unknown>): Promise<void>;
  /** Time limits grow on devnet. */
  slow: number;
};

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

async function localnet(): Promise<SeedTarget> {
  const bootstrap = readLocalnetBootstrap();
  const devusd = bootstrap.devusd;
  if (!devusd?.sottoProofs) throw new Error("this ledger has no devUSD with its sotto_proofs");
  const rpc = createRetryingRpc(bootstrap.rpcUrl);
  return {
    name: "localnet",
    rpc,
    wrappedMint: devusd.wrappedMint,
    sottoProofsProgram: devusd.sottoProofs.programId,
    keypair: async (key) => seededKeypair(`sotto-seed-northwind-${key}/v1`).keypair,
    admin: async () => e2eKeypair(),
    prepare: async (wallet, sol, whole) => {
      await fundLocalnetWallet(rpc, bootstrap, wallet, { sol, usdc: 0n });
      if (whole > 0n) await mintLocalnetDevusd(rpc, bootstrap, wallet, whole);
    },
    record: async (result) => {
      await writeFile(
        join(ROOT, ".localnet/seed-northwind.json"),
        `${JSON.stringify(result, null, 2)}\n`,
      );
    },
    slow: 1,
  };
}

async function devnet(): Promise<SeedTarget> {
  const dir = process.env.SOTTO_SEED_DIR;
  if (!dir) throw new Error("SOTTO_SEED_DIR is not set: the live seed runs only from its plan");
  const cluster = getClusterConfig("devnet");
  const devusd = cluster.available ? cluster.assets.find((asset) => asset.id === "devusd") : null;
  if (!devusd?.sottoProofs) throw new Error("the devnet registry has no devUSD with sotto_proofs");
  // The RPC endpoint from the worker's env file, never printed (ENGINEERING-RULES.md, local configuration).
  const env = parseEnv(await readFile(join(ROOT, "apps/worker/.env.local"), "utf8"));
  if (!env.RPC_URL) throw new Error("apps/worker/.env.local has no RPC_URL");
  const rpc = createRetryingRpc(env.RPC_URL);
  if ((await rpc.getGenesisHash().send()) !== GENESIS_HASHES.devnet) {
    throw new Error("the RPC_URL of apps/worker/.env.local does not serve devnet; refused");
  }
  const keypair = async (key: string) =>
    JSON.parse(await readFile(join(dir, `${key}.json`), "utf8")) as number[];
  return {
    name: "devnet",
    rpc,
    wrappedMint: devusd.wrappedMint,
    sottoProofsProgram: devusd.sottoProofs.program,
    keypair,
    admin: () => keypair("admin"),
    // Funded before the run (the live plan): SOL from wallet A, the treasury by the operator mint.
    prepare: async () => {},
    record: async (result) => {
      await writeFile(join(dir, "seed-result.json"), `${JSON.stringify(result, null, 2)}\n`, {
        mode: 0o600,
      });
    },
    slow: 3,
  };
}

export function seedTarget(): Promise<SeedTarget> {
  return process.env.SOTTO_SEED_TARGET === "devnet" ? devnet() : localnet();
}
