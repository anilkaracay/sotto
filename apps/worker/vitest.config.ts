import { defineConfig } from "vitest/config";

// Worker tests create and migrate a fresh database per file on the test server
// (scripts/db-local.sh test-up), and the start test spawns the worker entry as a process; under the
// parallel load of the CI node job either can exceed Vitest's 5 second default (step 1.10), so the
// limits match packages/db and apps/web. Localnet tests keep their own longer timeouts.
export default defineConfig({
  test: { testTimeout: 30_000, hookTimeout: 60_000 },
});
