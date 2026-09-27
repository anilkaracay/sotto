import { describe, expect, it } from "vitest";
import { runJobs, type Job } from "../src/jobs/runner.ts";

const quiet = () => {};

describe("job runner (08 section 4)", () => {
  it("runs each job once with --once and counts failures", async () => {
    const calls: string[] = [];
    const jobs: Job[] = [
      { name: "a", intervalMs: 1000, run: async () => (calls.push("a"), { done: 1 }) },
      {
        name: "b",
        intervalMs: 1000,
        run: async () => {
          calls.push("b");
          throw new Error("boom");
        },
      },
    ];
    const events: [string, Record<string, unknown>][] = [];
    const result = await runJobs(jobs, {
      signal: new AbortController().signal,
      once: true,
      log: (event, fields = {}) => events.push([event, fields]),
    });
    expect(calls).toEqual(["a", "b"]);
    expect(result.failures).toBe(1);
    expect(events.map(([event, fields]) => `${event}:${String(fields.job)}`)).toEqual([
      "job_run:a",
      "job_failed:b",
    ]);
  });

  it("repeats each job on its interval, keeps going after a failure, and stops on abort", async () => {
    const controller = new AbortController();
    let runs = 0;
    const job: Job = {
      name: "loop",
      intervalMs: 10,
      run: async () => {
        runs += 1;
        if (runs === 2) throw new Error("transient");
        if (runs === 4) controller.abort();
        return {};
      },
    };
    const sleeps: number[] = [];
    const result = await runJobs([job], {
      signal: controller.signal,
      log: quiet,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(runs).toBe(4);
    expect(result.failures).toBe(1);
    expect(sleeps).toEqual([10, 10, 10, 10]);
  });

  it("never overlaps a job with itself", async () => {
    const controller = new AbortController();
    let active = 0;
    let maxActive = 0;
    let runs = 0;
    const job: Job = {
      name: "slow",
      intervalMs: 0,
      run: async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        runs += 1;
        if (runs === 3) controller.abort();
        return {};
      },
    };
    await runJobs([job], { signal: controller.signal, log: quiet, sleep: async () => {} });
    expect(maxActive).toBe(1);
  });
});
