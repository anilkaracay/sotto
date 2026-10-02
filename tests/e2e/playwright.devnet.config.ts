// The acceptance scenario on devnet (step 3.11, 14): the localnet acceptance spec against the devnet
// app and worker already running on this machine (apps/web on port 3000 and apps/worker, each from
// its own .env.local), with fresh keypairs that wallet A funded. Started only by
// scripts/acceptance-devnet.ts (pnpm acceptance:devnet), which sets SOTTO_ACCEPTANCE_TARGET and the
// run's folder; no web server of its own and no fresh database, and never in CI.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./localnet",
  testMatch: "acceptance.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 3_600_000,
  expect: { timeout: 60_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-devnet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
