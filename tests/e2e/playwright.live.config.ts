// Runs against the hosted devnet app (step 4.3's live plan): the faucet check of live/faucet-check.spec.ts,
// started only by scripts/live-demo.ts with SOTTO_LIVE_URL and the run's folder. No web server of its
// own, no test database, never in CI.
import { defineConfig, devices } from "@playwright/test";

const url = process.env.SOTTO_LIVE_URL;
if (!url) throw new Error("SOTTO_LIVE_URL is not set: run through scripts/live-demo.ts");

export default defineConfig({
  testDir: "./live",
  workers: 1,
  retries: 0,
  timeout: 1_800_000,
  expect: { timeout: 60_000 },
  reporter: [["list"]],
  use: { baseURL: url, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium-live",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
