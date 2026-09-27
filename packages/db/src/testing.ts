// Test databases (docs/11-TESTING.md, API tests with a test Postgres). Each call creates a fresh,
// migrated database on the test server of scripts/db-local.sh test-up (trust authentication on the
// loopback interface, no secret) and drops it afterwards.
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { createDb, type Database } from "./client.ts";
import { migrateDatabase } from "./migrate.ts";

export const DEFAULT_TEST_SERVER_URL = "postgresql://postgres@127.0.0.1:56433/postgres";

export type TestDatabase = {
  name: string;
  url: string;
  db: Database;
  drop: () => Promise<void>;
};

function serverUrl(): string {
  return process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_SERVER_URL;
}

async function onServer<T>(run: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(serverUrl(), { max: 1, onnotice: () => {}, connect_timeout: 5 });
  try {
    return await run(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `sotto_test_${randomBytes(6).toString("hex")}`;
  try {
    await onServer((sql) => sql.unsafe(`create database ${name}`));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `cannot create a test database on ${serverUrl()} (${reason}); start the server with scripts/db-local.sh test-up`,
      { cause: error },
    );
  }
  const url = new URL(serverUrl());
  url.pathname = `/${name}`;
  await migrateDatabase(url.toString());
  const { db, close } = createDb(url.toString(), { max: 5 });
  return {
    name,
    url: url.toString(),
    db,
    drop: async () => {
      await close();
      await onServer((sql) => sql.unsafe(`drop database if exists ${name} with (force)`));
    },
  };
}
