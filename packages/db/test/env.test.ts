import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DB_ENV_FILE, loadDbEnv, requireDatabaseUrl } from "../src/env.ts";

describe("database script configuration", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sotto-db-env-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads packages/db/.env.local by default", () => {
    expect(DB_ENV_FILE.endsWith(join("packages", "db", ".env.local"))).toBe(true);
  });

  it("lets the file win over the process environment and ignores a missing file", () => {
    const file = join(dir, ".env.local");
    writeFileSync(file, "DATABASE_URL=postgresql://file@127.0.0.1:5432/db\nADMIN_WALLETS=\n");
    const env: NodeJS.ProcessEnv = { DATABASE_URL: "postgresql://shell@127.0.0.1:5432/db" };
    loadDbEnv(file, env);
    expect(env).toEqual({ DATABASE_URL: "postgresql://file@127.0.0.1:5432/db", ADMIN_WALLETS: "" });
    const untouched: NodeJS.ProcessEnv = { DATABASE_URL: "postgresql://platform@db.example/x" };
    loadDbEnv(join(dir, "missing"), untouched);
    expect(untouched).toEqual({ DATABASE_URL: "postgresql://platform@db.example/x" });
  });

  it("validates DATABASE_URL and never echoes it", () => {
    expect(requireDatabaseUrl({ DATABASE_URL: "postgresql://u:p@h:5432/d" })).toBe(
      "postgresql://u:p@h:5432/d",
    );
    expect(() => requireDatabaseUrl({})).toThrow("DATABASE_URL is not set");
    expect(() => requireDatabaseUrl({ DATABASE_URL: "mysql://u:secret@h/d" })).toThrow(
      "DATABASE_URL must be a postgres URL",
    );
    expect(() => requireDatabaseUrl({ DATABASE_URL: "not a url" })).toThrow(
      "DATABASE_URL is not a valid URL",
    );
  });
});
