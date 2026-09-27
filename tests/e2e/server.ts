// E2E web server: a fresh migrated database on the test Postgres (scripts/db-local.sh test-up), then
// the production build of apps/web through next start on port 3200. Configuration comes from this
// process's environment, which wins over apps/web/.env.local in Next.js (14 section 2).
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDatabase } from "@sotto/db/testing";

const PORT = 3200;
const WEB = fileURLToPath(new URL("../../apps/web", import.meta.url));

if (!existsSync(join(WEB, ".next", "BUILD_ID"))) {
  console.error("error: apps/web has no production build; run pnpm build first");
  process.exit(1);
}

const database = await createTestDatabase();
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
      RPC_URL: "http://127.0.0.1:8899",
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
