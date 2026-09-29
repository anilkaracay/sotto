// payroll-runs (08 section 4, AC-08.2; step 2.3). Every 5 seconds, with no RPC call: the
// confirm-executions job settles each payroll line at finality, and this job moves the runs:
// - an executing or partially settled run whose every line is settled becomes settled;
// - an executing run with no line in flight and no attempt in the last three minutes (the landing
//   window of confirm-executions) was left by its page, for example a closed tab: it becomes
//   partially settled when a line landed or is landing, otherwise not paid (failed), so the owner can
//   resume it. The page itself reports a stop when it ends early.
import { paymentAttempts, payments, payrollRuns, type Database } from "@sotto/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { LANDING_WINDOW_MS } from "./confirm-executions.ts";
import type { Job } from "./runner.ts";

export const PAYROLL_RUNS_INTERVAL_MS = 5_000;

export type PayrollRunsDeps = { db: Database; now?: () => Date };

export function payrollRunsJob(deps: PayrollRunsDeps): Job {
  return {
    name: "payroll-runs",
    intervalMs: PAYROLL_RUNS_INTERVAL_MS,
    run: async () => {
      const now = deps.now?.() ?? new Date();
      const windowStart = new Date(now.getTime() - LANDING_WINDOW_MS);
      const settled = await deps.db
        .update(payrollRuns)
        .set({ status: "settled", updatedAt: now })
        .where(
          and(
            inArray(payrollRuns.status, ["executing", "partially_settled"]),
            sql`not exists (select 1 from ${payments} where ${payments.runId} = ${payrollRuns.id} and ${payments.status} <> 'settled')`,
          ),
        )
        .returning({ id: payrollRuns.id });
      const stopped = await deps.db
        .update(payrollRuns)
        .set({
          status: sql`case when exists (select 1 from ${payments} where ${payments.runId} = ${payrollRuns.id} and ${payments.status} in ('settled', 'executing')) then 'partially_settled'::payroll_run_status else 'failed'::payroll_run_status end`,
          updatedAt: now,
        })
        .where(
          and(
            eq(payrollRuns.status, "executing"),
            sql`not exists (select 1 from ${paymentAttempts} inner join ${payments} on ${payments.id} = ${paymentAttempts.paymentId} where ${payments.runId} = ${payrollRuns.id} and (${paymentAttempts.status} in ('sent', 'confirmed') or ${paymentAttempts.createdAt} > ${windowStart.toISOString()}::timestamptz))`,
          ),
        )
        .returning({ id: payrollRuns.id, status: payrollRuns.status });
      return { settled: settled.length, stopped: stopped.length };
    },
  };
}
