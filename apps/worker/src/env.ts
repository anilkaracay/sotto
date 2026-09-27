// Local configuration (ENGINEERING-RULES.md "Local configuration and secrets"): the worker reads its git ignored
// .env.local with Node's env file parser (util.parseEnv, the parser behind node --env-file). Values
// from the file win over the process environment, so a stale shell variable can never replace a
// local value. A deployed worker has no .env.local and reads its platform environment. Only
// variable names are ever returned or printed, never values.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

export const LOCAL_ENV_FILE = fileURLToPath(new URL("../.env.local", import.meta.url));

/** Applies the file's variables to `env` and returns their names; a missing file changes nothing. */
export function loadLocalEnv(
  path: string = LOCAL_ENV_FILE,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (!existsSync(path)) return [];
  const names: string[] = [];
  for (const [name, value] of Object.entries(parseEnv(readFileSync(path, "utf8")))) {
    if (value === undefined) continue;
    env[name] = value;
    names.push(name);
  }
  return names;
}
