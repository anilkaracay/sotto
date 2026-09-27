// Worker entry logic. Jobs (confirmations, SAS issuance, proof program health) arrive later in Phase 1.
// Configuration comes from the environment: apps/worker/.env.local when it exists (local development,
// src/env.ts), otherwise only the platform's environment variables (hosted, 14 section 2). A missing
// or invalid variable stops the worker with its name; values are never printed.
import { ConfigError, loadWorkerConfig } from "./config.ts";

export function main(env: Readonly<Record<string, string | undefined>> = process.env): number {
  try {
    loadWorkerConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`sotto worker: configuration error: ${error.message}`);
      return 1;
    }
    throw error;
  }
  console.log("sotto worker: started, no jobs configured, exiting");
  return 0;
}
