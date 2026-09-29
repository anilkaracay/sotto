// confirm-executions (08 section 4, 06 section 5; step 1.9). Every 5 seconds the job reads the
// signature status (with history) of the transfer transaction of each unsettled payment attempt:
// - finalized without an error: the attempt is finalized and the payment settled, with the slot and
//   the attempt's signatures;
// - an error: the attempt failed with the decoded error, and an executing payment failed (the page then
//   closes the proof accounts and records failed_clean);
// - confirmed: the attempt is confirmed;
// - not found three minutes after the attempt started: its blockhash has expired, so it can never
//   land; the attempt failed as transfer_not_found.
// An attempt the page ended as failed_clean is still read for those three minutes, so a transfer that
// landed after all is settled and never sent again (I-7). With nothing to check it makes no RPC call.
// Since step 2.4 a settled payment records when it settled (a period grant needs it) and a single
// payment's settlement is written to the access log (AC-14.1, metadata only).
import { insertAccessEvent, paymentAttempts, payments, type Database } from "@sotto/db";
import type { SolanaRpc } from "@sotto/sdk/tx";
import type { Signature } from "@solana/kit";
import { and, eq, gt, inArray, isNotNull, isNull, ne, or } from "drizzle-orm";
import type { Job } from "./runner.ts";

export const CONFIRM_EXECUTIONS_INTERVAL_MS = 5_000;
/** A transaction whose blockhash is older than this cannot land any more (about 150 blocks). */
export const LANDING_WINDOW_MS = 3 * 60_000;
const BATCH = 100;

export type ConfirmExecutionsDeps = { db: Database; rpc: SolanaRpc; now?: () => Date };

function errorCode(err: unknown): string {
  const text = JSON.stringify(err, (_, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );
  return `onchain:${text}`.slice(0, 200);
}

export function confirmExecutionsJob(deps: ConfirmExecutionsDeps): Job {
  return {
    name: "confirm-executions",
    intervalMs: CONFIRM_EXECUTIONS_INTERVAL_MS,
    run: async () => {
      const now = deps.now?.() ?? new Date();
      const windowStart = new Date(now.getTime() - LANDING_WINDOW_MS);
      const rows = await deps.db
        .select({
          attempt: paymentAttempts,
          paymentStatus: payments.status,
          kind: payments.kind,
          orgId: payments.orgId,
        })
        .from(paymentAttempts)
        .innerJoin(payments, eq(payments.id, paymentAttempts.paymentId))
        .where(
          and(
            isNotNull(paymentAttempts.transferSignature),
            isNull(payments.settledSlot),
            ne(payments.status, "settled"),
            or(
              inArray(paymentAttempts.status, ["sent", "confirmed"]),
              and(
                eq(paymentAttempts.status, "failed_clean"),
                gt(paymentAttempts.createdAt, windowStart),
              ),
            ),
          ),
        )
        .limit(BATCH);
      if (rows.length === 0) return { checked: 0, settled: 0 };
      const { value: statuses } = await deps.rpc
        .getSignatureStatuses(
          rows.map((row) => row.attempt.transferSignature as Signature),
          { searchTransactionHistory: true },
        )
        .send();
      let settled = 0;
      let failed = 0;
      for (const [index, row] of rows.entries()) {
        const { attempt } = row;
        const status = statuses[index] ?? null;
        if (status === null) {
          if (attempt.createdAt <= windowStart && attempt.status !== "failed_clean") {
            await deps.db
              .update(paymentAttempts)
              .set({ status: "failed", errorCode: "transfer_not_found" })
              .where(eq(paymentAttempts.id, attempt.id));
            await deps.db
              .update(payments)
              .set({ status: "failed", errorCode: "transfer_not_found", updatedAt: now })
              .where(and(eq(payments.id, attempt.paymentId), eq(payments.status, "executing")));
            failed += 1;
          }
          continue;
        }
        if (status.err !== null) {
          if (attempt.status === "failed_clean") continue;
          const code = errorCode(status.err);
          await deps.db
            .update(paymentAttempts)
            .set({ status: "failed", errorCode: code })
            .where(eq(paymentAttempts.id, attempt.id));
          await deps.db
            .update(payments)
            .set({ status: "failed", errorCode: code, updatedAt: now })
            .where(and(eq(payments.id, attempt.paymentId), eq(payments.status, "executing")));
          failed += 1;
          continue;
        }
        if (status.confirmationStatus === "finalized") {
          await deps.db
            .update(paymentAttempts)
            .set({ status: "finalized", errorCode: null })
            .where(eq(paymentAttempts.id, attempt.id));
          await deps.db
            .update(payments)
            .set({
              status: "settled",
              settledSlot: status.slot,
              signatures: attempt.signatures,
              errorCode: null,
              updatedAt: now,
              settledAt: now,
            })
            .where(eq(payments.id, attempt.paymentId));
          if (row.kind === "single") {
            await insertAccessEvent(deps.db, {
              orgId: row.orgId,
              actorUserId: null,
              action: "payment_settled",
              subjectType: "payment",
              subjectId: attempt.paymentId,
              metadata: { slot: status.slot.toString(), attemptNo: attempt.attemptNo },
            });
          }
          settled += 1;
        } else if (attempt.status === "sent") {
          await deps.db
            .update(paymentAttempts)
            .set({ status: "confirmed" })
            .where(eq(paymentAttempts.id, attempt.id));
        }
      }
      return { checked: rows.length, settled, failed };
    },
  };
}
