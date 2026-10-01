// E2E (docs/11-TESTING.md): Playwright against the production build of apps/web, served by server.ts
// with a fresh test database. Build first (pnpm build); scripts/ci-local.sh runs this after its build.
import { defineConfig, devices } from "@playwright/test";

const PORT = 3200;

export default defineConfig({
  // Step 3.8: the approved screens' baselines, one folder per spec, without the platform's name
  // (they are taken on the local CI's macOS machine, D-25; visual.ts).
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  testDir: "./specs",
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    // The app is desktop first, minimum width 1280 (09 section 2).
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: "node server.ts",
    url: `http://localhost:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
