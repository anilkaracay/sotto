// pnpm --filter @sotto/db migrate: applies the migrations to DATABASE_URL (packages/db/.env.local
// locally, the platform's variable when hosted). Prints no connection details.
import { loadDbEnv, requireDatabaseUrl } from "../env.ts";
import { migrateDatabase } from "../migrate.ts";

try {
  loadDbEnv();
  await migrateDatabase(requireDatabaseUrl());
  console.log("migrations applied");
} catch (error) {
  console.error(
    `error: ${error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/g, "<database-url>") : String(error)}`,
  );
  process.exitCode = 1;
}
