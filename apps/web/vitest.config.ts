import { defineConfig } from "vitest/config";

// Next.js compiles JSX itself (tsconfig "jsx": "preserve"); tests need Vite to transform it.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
});
