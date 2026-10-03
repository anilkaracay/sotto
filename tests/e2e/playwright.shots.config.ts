// Screenshots for a design review (step 4.3; founder, 2026-10-03): the new devUSD elements at 1440 and
// 390, written to SOTTO_SHOTS_DIR. Not part of CI. SOTTO_SHOTS=devusd (the default) runs
// shots/devusd.spec.ts on the bootstrapped local validator; SOTTO_SHOTS=faucet runs
// shots/faucet-card.spec.ts on the e2e server in its devnet configuration, where the faucet card shows,
// with the faucet's answers stood in by the spec (the faucet itself runs on devnet only).
import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;
const faucet = process.env.SOTTO_SHOTS === "faucet";

export default defineConfig({
  testDir: "./shots",
  testMatch: faucet ? "faucet-card.spec.ts" : "devusd.spec.ts",
  workers: 1,
  retries: 0,
  timeout: 600_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium-shots",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: faucet ? "node server.ts" : "node server.ts --localnet",
    url: `http://localhost:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
