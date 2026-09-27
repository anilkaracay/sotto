import { defineConfig } from "vitest/config";

// Next.js compiles JSX itself (tsconfig "jsx": "preserve"); tests need Vite to transform it.
// API tests create and migrate a fresh database per file on the test server
// (scripts/db-local.sh test-up).
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: { testTimeout: 30_000, hookTimeout: 60_000 },
});
