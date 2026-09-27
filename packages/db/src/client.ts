// Database client: postgres.js with Drizzle. `prepare: false` keeps queries compatible with
// transaction pooling (for example the Neon pooler, D-12).
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

export type Database = PostgresJsDatabase<typeof schema>;
export type DatabaseClient = { db: Database; close: () => Promise<void> };

export function createDb(url: string, options: { max?: number } = {}): DatabaseClient {
  const client = postgres(url, {
    max: options.max ?? 5,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}
