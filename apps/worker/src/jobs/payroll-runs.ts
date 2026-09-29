// payroll-runs (08 section 4, AC-08.2; step 2.3). Every 5 seconds, with no RPC call: the
// confirm-executions job settles each payroll line at finality, and this job moves the runs:
// - an executing or partially settled run whose every line is settled becomes settled;
// - an executing run with no line in flight and no attempt in the last ten minutes was left by its
//   page, for example a closed tab: it becomes partially settled when a line landed or is landing,
//   otherwise not paid (failed), so the owner can resume it. Ten minutes, well past the landing
//   window of confirm-executions, so an owner who takes a few minutes over a chunk's wallet prompt
//   is not stopped. The page itself reports a stop when it ends early.
import {
  insertAccessEvent,
  paymentAttempts,
  payments,
  payrollRuns,
  type Database,
} from "@sotto/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Job } from "./runner.ts";

export const PAYROLL_RUNS_INTERVAL_MS = 5_000;
/** A run with nothing in flight and no attempt for this long was left by its page. */
export const STALE_RUN_MS = 10 * 60_000;

export type PayrollRunsDeps = { db: Database; now?: () => Date };

export function payrollRunsJob(deps: PayrollRunsDeps): Job {
  return {
    name: "payroll-runs",
    intervalMs: PAYROLL_RUNS_INTERVAL_MS,
    run: async () => {
      const now = deps.now?.() ?? new Date();
      const windowStart = new Date(now.getTime() - STALE_RUN_MS);
      const settled = await deps.db
        .update(payrollRuns)
        .set({ status: "settled", updatedAt: now })
        .where(
          and(
            inArray(payrollRuns.status, ["executing", "partially_settled"]),
            sql`not exists (select 1 from ${payments} where ${payments.runId} = ${payrollRuns.id} and ${payments.status} <> 'settled')`,
          ),
        )
        .returning({ id: payrollRuns.id, orgId: payrollRuns.orgId, lines: payrollRuns.lineCount });
      // AC-14.1: metadata only.
      for (const run of settled) {
        await insertAccessEvent(deps.db, {
          orgId: run.orgId,
          actorUserId: null,
          action: "payroll_run_settled",
          subjectType: "payroll_run",
          subjectId: run.id,
          metadata: { lines: run.lines },
        });
      }
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
        .returning({ id: payrollRuns.id, orgId: payrollRuns.orgId, status: payrollRuns.status });
      for (const run of stopped) {
        await insertAccessEvent(deps.db, {
          orgId: run.orgId,
          actorUserId: null,
          action: "payroll_run_stopped",
          subjectType: "payroll_run",
          subjectId: run.id,
          metadata: { status: run.status, by: "worker" },
        });
      }
      return { settled: settled.length, stopped: stopped.length };
    },
  };
}
