// E2E web server: a fresh migrated database on the test Postgres (scripts/db-local.sh test-up) with the
// E2E admin wallet, then the production build of apps/web through next start on port 3200. Configuration
// comes from this process's environment, which wins over apps/web/.env.local in Next.js (14 section 2).
// With --localnet (the localnet specs, step 1.7) the app runs on the bootstrapped local validator:
// NEXT_PUBLIC_CLUSTER localnet, its RPC URL and the local USDC mint from .localnet/bootstrap.json.
// Since step 1.9 --localnet also runs the worker's job loop on that validator and database (payment
// settlement, the proof program check, readiness, attestations with the bootstrap's SAS signer). The
// worker runs from a copy without apps/worker/.env.local, whose values would win over this
// environment (14 section 2), as the worker's start test does. Since step 2.8 the web also gets the
// ledger's sotto_proofs program and SAS credential and schema, for the proofs page and /v/<address>.
// Since step 3.6 --localnet writes the database's address to .localnet/e2e-database-url (git ignored,
// removed on stop) for the sharing screens spec, which shows the paused proof program banner. Since
// step 4.3 the web and the worker also get the ledger's devUSD mint, and the web its sotto_proofs.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  cpSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { admins, clusterHealth } from "@sotto/db";
import { createTestDatabase } from "@sotto/db/testing";
import { E2E_ADMIN_WALLET } from "./fixtures.ts";

const PORT = 3200;
const WEB = fileURLToPath(new URL("../../apps/web", import.meta.url));
const WORKER = fileURLToPath(new URL("../../apps/worker", import.meta.url));

if (!existsSync(join(WEB, ".next", "BUILD_ID"))) {
  console.error("error: apps/web has no production build; run pnpm build first");
  process.exit(1);
}

type Bootstrap = {
  rpcUrl: string;
  usdcMint: string;
  sas: { signerKeypair: string; credential: string; schema: string };
  sottoProofs: { programId: string } | null;
  /** Step 4.3: the ledger's devUSD and its own sotto_proofs deployment. */
  devusd?: { mint: string; sottoProofs: { programId: string } | null };
};

const localnet = process.argv.includes("--localnet");
const chain: Record<string, string> = { RPC_URL: "http://127.0.0.1:8899" };
let bootstrap: Bootstrap | null = null;
if (localnet) {
  bootstrap = JSON.parse(
    readFileSync(new URL("../../.localnet/bootstrap.json", import.meta.url), "utf8"),
  ) as Bootstrap;
  chain.RPC_URL = bootstrap.rpcUrl;
  chain.NEXT_PUBLIC_CLUSTER = "localnet";
  chain.LOCALNET_USDC_MINT = bootstrap.usdcMint;
  // Step 2.8: the ledger's sotto_proofs and SAS addresses, for the proofs page and /v/<address>.
  chain.LOCALNET_SAS_CREDENTIAL = bootstrap.sas.credential;
  chain.LOCALNET_SAS_SCHEMA = bootstrap.sas.schema;
  if (bootstrap.sottoProofs) chain.LOCALNET_SOTTO_PROOFS_PROGRAM = bootstrap.sottoProofs.programId;
  // Step 4.3: devUSD, the second asset an organization can choose.
  if (bootstrap.devusd) {
    chain.LOCALNET_DEVUSD_MINT = bootstrap.devusd.mint;
    if (bootstrap.devusd.sottoProofs) {
      chain.LOCALNET_DEVUSD_SOTTO_PROOFS_PROGRAM = bootstrap.devusd.sottoProofs.programId;
    }
  }
}

const database = await createTestDatabase();
const DATABASE_URL_FILE = fileURLToPath(
  new URL("../../.localnet/e2e-database-url", import.meta.url),
);
if (bootstrap) writeFileSync(DATABASE_URL_FILE, `${database.url}\n`, { mode: 0o600 });
// The fixed keypair wallet of the keys spec is a Sotto admin, so the spec approves its own org.
await database.db.insert(admins).values({ wallet: E2E_ADMIN_WALLET });
// Step 2.10: on localnet the web's and the worker's output also goes to .localnet/e2e-server.log
// (git ignored, new each run), where the acceptance spec checks that no log line holds an amount or a
// memo of its scenario (I-2).
const serverLog = bootstrap
  ? createWriteStream(new URL("../../.localnet/e2e-server.log", import.meta.url), { flags: "w" })
  : null;
function tee(child: ChildProcess): ChildProcess {
  child.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(chunk);
    serverLog?.write(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(chunk);
    serverLog?.write(chunk);
  });
  return child;
}

let worker: ChildProcess | null = null;
let workerDir: string | null = null;
if (bootstrap) {
  workerDir = mkdtempSync(join(tmpdir(), "sotto-e2e-worker-"));
  cpSync(join(WORKER, "src"), join(workerDir, "src"), { recursive: true });
  copyFileSync(join(WORKER, "package.json"), join(workerDir, "package.json"));
  symlinkSync(join(WORKER, "node_modules"), join(workerDir, "node_modules"), "dir");
  worker = tee(
    spawn(process.execPath, [join(workerDir, "src", "index.ts")], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        PATH: process.env.PATH ?? "",
        RPC_URL: bootstrap.rpcUrl,
        DATABASE_URL: database.url,
        SAS_SIGNER_KEYPAIR: bootstrap.sas.signerKeypair,
        SAS_CREDENTIAL_ADDRESS: bootstrap.sas.credential,
        SAS_SCHEMA_ADDRESS: bootstrap.sas.schema,
        LOCALNET_USDC_MINT: bootstrap.usdcMint,
        ...(bootstrap.devusd ? { LOCALNET_DEVUSD_MINT: bootstrap.devusd.mint } : {}),
      },
    }),
  );
}

// Step 2.9 (F-19): every /app page shows the proof program banner until the worker's first verdict
// is stored, so on localnet the web starts once that verdict is in cluster_health.
if (bootstrap) {
  const deadline = Date.now() + 120_000;
  while ((await database.db.select().from(clusterHealth).limit(1)).length === 0) {
    if (Date.now() > deadline) {
      console.error("error: the worker stored no proof program verdict within 120 seconds");
      worker?.kill("SIGTERM");
      rmSync(DATABASE_URL_FILE, { force: true });
      await database.drop().catch(() => {});
      process.exit(1);
    }
    await delay(500);
  }
}

const web = tee(
  spawn(
    process.execPath,
    [join(WEB, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)],
    {
      cwd: WEB,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: database.url,
        SESSION_SECRET: randomBytes(32).toString("hex"),
        NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
        ...chain,
      },
    },
  ),
);

let stopping = false;
async function stop(code: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  web.kill("SIGTERM");
  worker?.kill("SIGTERM");
  if (workerDir) rmSync(workerDir, { recursive: true, force: true });
  rmSync(DATABASE_URL_FILE, { force: true });
  await database.drop().catch(() => {});
  process.exit(code);
}
process.on("SIGTERM", () => void stop(0));
process.on("SIGINT", () => void stop(0));
web.on("exit", (code) => void stop(code ?? 1));
