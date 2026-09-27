import { defineConfig } from "vitest/config";

// Database tests create and migrate a fresh database per file on the test server
// (scripts/db-local.sh test-up).
export default defineConfig({
  test: { testTimeout: 30_000, hookTimeout: 60_000 },
});
