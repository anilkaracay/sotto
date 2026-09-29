// The worker process (08 section 4). Configuration comes from the environment: apps/worker/.env.local
// when it exists (local development, src/env.ts), otherwise only the platform's environment variables
// (hosted, 14 section 2). A missing or invalid variable stops the worker with its name; values are
// never printed. With --once each job runs one time and the process exits.
import { createDb } from "@sotto/db";
import { createRetryingRpc } from "@sotto/sdk/tx";
import { ConfigError, loadWorkerConfig } from "./config.ts";
import { confirmExecutionsJob } from "./jobs/confirm-executions.ts";
import { payrollRunsJob } from "./jobs/payroll-runs.ts";
import { pendingCreditsJob } from "./jobs/pending-credits.ts";
import { proofProgramHealthJob } from "./jobs/proof-program-health.ts";
import { recipientReadinessJob } from "./jobs/recipient-readiness.ts";
import { runJobs } from "./jobs/runner.ts";
import { sasIssueJob } from "./jobs/sas-issue.ts";
import { loadKeypairSigner } from "./keypair.ts";
import { log } from "./log.ts";

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<number> {
  let config;
  try {
    config = loadWorkerConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`sotto worker: configuration error: ${error.message}`);
      return 1;
    }
    throw error;
  }
  let signer;
  try {
    signer = await loadKeypairSigner(config.sasSignerKeypair);
  } catch (error) {
    console.error(
      `sotto worker: configuration error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
  const once = argv.includes("--once");
  const { db, close } = createDb(config.databaseUrl, { max: 3 });
  const rpc = createRetryingRpc(config.rpcUrl, {
    onRetry: (retry, max, delayMs) =>
      log("rpc_busy", { message: "network busy, retrying", retry, max, delayMs }, "warn"),
  });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  const jobs = [
    sasIssueJob({
      db,
      sas: { rpc, signer },
      credential: config.sasCredentialAddress,
      schemaAddress: config.sasSchemaAddress,
    }),
    pendingCreditsJob({ db, rpc }),
    recipientReadinessJob({ db, rpc, localnetUsdcMint: config.localnetUsdcMint }),
    confirmExecutionsJob({ db, rpc }),
    payrollRunsJob({ db }),
    proofProgramHealthJob({ db, rpc, feePayer: signer.address }),
  ];
  log("worker_started", { jobs: jobs.map((job) => job.name), once, signer: signer.address });
  try {
    const { failures } = await runJobs(jobs, { signal: controller.signal, log, once });
    return once && failures > 0 ? 1 : 0;
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
    await close();
    log("worker_stopped");
  }
}
