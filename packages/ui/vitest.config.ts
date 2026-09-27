import { defineConfig } from "vitest/config";

// Components render with react-dom/server; CSS Modules keep their local class names in tests.
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  test: { css: { include: [/.+/], modules: { classNameStrategy: "non-scoped" } } },
});
