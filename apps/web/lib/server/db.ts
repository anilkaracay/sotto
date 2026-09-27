// One database client per DATABASE_URL for the lifetime of the server instance.
import { createDb, type Database, type DatabaseClient } from "@sotto/db";
import { databaseUrl } from "./config.ts";

const clients = new Map<string, DatabaseClient>();

export function getDb(): Database {
  const url = databaseUrl();
  let client = clients.get(url);
  if (!client) {
    client = createDb(url, { max: 5 });
    clients.set(url, client);
  }
  return client.db;
}

export async function closeDbClients(): Promise<void> {
  const all = [...clients.values()];
  clients.clear();
  await Promise.all(all.map((client) => client.close()));
}
