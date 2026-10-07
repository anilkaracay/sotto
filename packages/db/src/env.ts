// Configuration for the database scripts (migrate, seed): packages/db/.env.local, git ignored, loaded
// with dotenv (ENGINEERING-RULES.md "Local configuration and secrets"). The file wins over the process
// environment, like the worker's loader. Hosted runs have no file and use the
// platform's variables; a missing file changes nothing.
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export const DB_ENV_FILE = fileURLToPath(new URL("../.env.local", import.meta.url));

export function loadDbEnv(path: string = DB_ENV_FILE, env: NodeJS.ProcessEnv = process.env): void {
  dotenv.config({ path, override: true, quiet: true, processEnv: env as Record<string, string> });
}

export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL is not set");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must be a postgres URL");
  }
  return value;
}
