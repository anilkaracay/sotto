// The demo seed (step 4.3, seed/northwind.spec.ts). The dry run (default) is on the bootstrapped local
// validator with the e2e server; SOTTO_SEED_TARGET=devnet with SOTTO_SEED_URL runs it against the hosted
// app, only from the founder's approved live plan. Never part of CI: it makes one organization.
import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;
const live = process.env.SOTTO_SEED_TARGET === "devnet";
const liveUrl = process.env.SOTTO_SEED_URL;
if (live && !liveUrl) throw new Error("SOTTO_SEED_URL is not set for the live seed");

export default defineConfig({
  testDir: "./seed",
  workers: 1,
  retries: 0,
  timeout: 3_600_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL: live ? liveUrl : `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-seed",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  ...(live
    ? {}
    : {
        webServer: {
          command: "node server.ts --localnet",
          url: `http://localhost:${PORT}/api/health`,
          timeout: 120_000,
          reuseExistingServer: false,
          stdout: "pipe" as const,
          stderr: "pipe" as const,
        },
      }),
});
