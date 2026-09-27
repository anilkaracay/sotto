// E2E web server: a fresh migrated database on the test Postgres (scripts/db-local.sh test-up) with the
// E2E admin wallet, then the production build of apps/web through next start on port 3200. Configuration
// comes from this process's environment, which wins over apps/web/.env.local in Next.js (14 section 2).
// With --localnet (the localnet specs, step 1.7) the app runs on the bootstrapped local validator:
// NEXT_PUBLIC_CLUSTER localnet, its RPC URL and the local USDC mint from .localnet/bootstrap.json.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { admins } from "@sotto/db";
import { createTestDatabase } from "@sotto/db/testing";
import { E2E_ADMIN_WALLET } from "./fixtures.ts";

const PORT = 3200;
const WEB = fileURLToPath(new URL("../../apps/web", import.meta.url));

if (!existsSync(join(WEB, ".next", "BUILD_ID"))) {
  console.error("error: apps/web has no production build; run pnpm build first");
  process.exit(1);
}

const chain: Record<string, string> = { RPC_URL: "http://127.0.0.1:8899" };
if (process.argv.includes("--localnet")) {
  const bootstrap = JSON.parse(
    readFileSync(new URL("../../.localnet/bootstrap.json", import.meta.url), "utf8"),
  ) as { rpcUrl: string; usdcMint: string };
  chain.RPC_URL = bootstrap.rpcUrl;
  chain.NEXT_PUBLIC_CLUSTER = "localnet";
  chain.LOCALNET_USDC_MINT = bootstrap.usdcMint;
}

const database = await createTestDatabase();
// The fixed keypair wallet of the keys spec is a Sotto admin, so the spec approves its own org.
await database.db.insert(admins).values({ wallet: E2E_ADMIN_WALLET });
const web = spawn(
  process.execPath,
  [join(WEB, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)],
  {
    cwd: WEB,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: database.url,
      SESSION_SECRET: randomBytes(32).toString("hex"),
      NEXT_PUBLIC_APP_URL: `http://localhost:${PORT}`,
      ...chain,
    },
  },
);

let stopping = false;
async function stop(code: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  web.kill("SIGTERM");
  await database.drop().catch(() => {});
  process.exit(code);
}
process.on("SIGTERM", () => void stop(0));
process.on("SIGINT", () => void stop(0));
web.on("exit", (code) => void stop(code ?? 1));
