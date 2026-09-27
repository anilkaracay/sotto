// drizzle-kit configuration for `pnpm --filter @sotto/db generate` (SQL migrations from src/schema.ts).
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  strict: true,
});
