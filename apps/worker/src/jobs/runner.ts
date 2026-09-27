// Worker job loop (08 section 4). Every job runs on its own interval and never overlaps itself; a
// failed run is logged and retried at the next interval; an abort (SIGTERM, SIGINT) stops the loop
// once the running jobs finish. `once` runs each job one time, which tests and operations use.
import { setTimeout as delay } from "node:timers/promises";
import type { Logger } from "../log.ts";

export type JobContext = { signal: AbortSignal; log: Logger };

export type Job = {
  name: string;
  intervalMs: number;
  run: (context: JobContext) => Promise<Record<string, unknown>>;
};

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  try {
    await delay(ms, undefined, { signal });
  } catch {
    // Aborted: the loop checks the signal.
  }
}

export async function runJobs(
  jobs: readonly Job[],
  options: { signal: AbortSignal; log: Logger; once?: boolean; sleep?: typeof wait },
): Promise<{ failures: number }> {
  const sleep = options.sleep ?? wait;
  let failures = 0;
  const runOne = async (job: Job): Promise<void> => {
    const started = Date.now();
    try {
      const result = await job.run({ signal: options.signal, log: options.log });
      options.log("job_run", { job: job.name, durationMs: Date.now() - started, ...result });
    } catch (error) {
      failures += 1;
      options.log(
        "job_failed",
        { job: job.name, durationMs: Date.now() - started, error },
        "error",
      );
    }
  };
  if (options.once) {
    for (const job of jobs) await runOne(job);
    return { failures };
  }
  await Promise.all(
    jobs.map(async (job) => {
      while (!options.signal.aborted) {
        await runOne(job);
        await sleep(job.intervalMs, options.signal);
      }
    }),
  );
  return { failures };
}
