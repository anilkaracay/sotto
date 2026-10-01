// The localnet E2E specs (step 1.7, docs/11-TESTING.md): the browser flows that send transactions, with
// the injected test wallet, against the production build of apps/web on the bootstrapped local
// validator (server.ts --localnet). scripts/ci-local.sh runs them in the localnet job after the
// bootstrap; they never touch devnet.
import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;

export default defineConfig({
  // Step 3.8: the approved screens' baselines, one folder per spec, without the platform's name
  // (they are taken on the local CI's macOS machine, D-25; visual.ts).
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  testDir: "./localnet",
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-localnet",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: "node server.ts --localnet",
    url: `http://localhost:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
