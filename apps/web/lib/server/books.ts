// Accountant books (F-11, AC-11.1 to AC-11.4, 09 section 3; step 2.5). An accountant reads an org's
// books through the viewing grants they hold there: the scope banner comes from those grants, and the
// ledger is the accountant's own records under them (GET /orgs/:id/disclosures), opened in their tab.
// This module serves what the records do not carry, for exactly the payments the accountant holds a
// readable record of, and nothing about any other: when the payment settled, its transfer's accounts
// and time as the chain shows them (chain_activity), the recipient's screening before it, who approved
// it, and its reconciliation status. No amount exists here: amounts live only in the records' sealed
// boxes. Reconciliation is a status only, matched or needs receipt (D-27: no notes); the accountant
// holding the payment's record or the owner sets it. An export is generated in the accountant's tab;
// the server only writes the event (who, when, which grant, how many rows, which filters) to the
// access log, never the rows or the search text, which may hold an amount (I-2).
import {
  approvals,
  chainActivity,
  disclosures,
  grants,
  insertAccessEvent,
  orgs,
  paymentAttempts,
  payments,
  payrollRuns,
  reconciliations,
  recipients,
  screenings,
  users,
  type Database,
} from "@sotto/db";
import { and, desc, eq, inArray, isNotNull, lte, ne, or } from "drizzle-orm";
import { z } from "zod";
import { ApiError, apiErrors } from "./errors.ts";
import { readableGrantCondition } from "./grants.ts";
import { requireMoneyAccess } from "./orgs.ts";
import type { Session } from "./session.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const booksErrors = {
  noGrant: () =>
    new ApiError(403, "books_no_grant", "You hold no active viewing key for this organization"),
  paymentNotFound: () => new ApiError(404, "payment_not_found", "Payment not found"),
};

export type BooksGrantView = {
  id: string;
  scope: "all_payments" | "period" | "payroll_only";
  periodFrom: string | null;
  periodTo: string | null;
  expiresAt: string | null;
  activatedAt: string | null;
  grantedBy: { name: string | null; wallet: string };
};

export type BooksPaymentView = {
  id: string;
  kind: "single" | "payroll_line";
  status: string;
  settledAt: string | null;
  run: { id: string; title: string } | null;
  /** The transfer as the chain shows it: the org's account, the recipient's, and the block time. */
  chain: { signature: string; from: string; to: string; blockTime: string | null } | null;
  /** The recipient's latest screening at or before the payment settled (D-10). */
  screening: "clear" | "hit" | "error" | null;
  /** The initiator's approval, recorded with the execution signature (Q-11). */
  approvedBy: { name: string | null; wallet: string; at: string } | null;
  reconciliation: { status: "matched" | "needs_receipt"; updatedAt: string } | null;
};

export type BooksView = {
  org: { id: string; displayName: string };
  ownerWallet: string;
  grants: BooksGrantView[];
  payments: BooksPaymentView[];
};

/** The caller's readable grants in the org (active, not past their expiry), not own payslips. */
async function heldGrants(db: Database, session: Session, orgId: string, now: Date) {
  return db
    .select()
    .from(grants)
    .where(
      and(
        eq(grants.orgId, orgId),
        eq(grants.viewerUserId, session.userId),
        ne(grants.scope, "own_payslips"),
        readableGrantCondition(now),
      ),
    )
    .orderBy(desc(grants.createdAt));
}

/** The payments the caller holds a record of under those grants. */
async function heldPaymentIds(
  db: Database,
  session: Session,
  orgId: string,
  grantIds: string[],
): Promise<string[]> {
  if (grantIds.length === 0) return [];
  const rows = await db
    .selectDistinct({ subject: disclosures.subject })
    .from(disclosures)
    .where(
      and(
        eq(disclosures.orgId, orgId),
        eq(disclosures.viewerUserId, session.userId),
        inArray(disclosures.grantId, grantIds),
        inArray(disclosures.kind, ["payment", "payroll_line"]),
      ),
    );
  return rows.map((row) => row.subject).filter((subject) => UUID.test(subject));
}

export async function readBooks(
  db: Database,
  session: Session | null,
  orgId: string,
  now = new Date(),
): Promise<BooksView> {
  await requireMoneyAccess(db, session, orgId, ["accountant"]);
  if (!session) throw apiErrors.unauthenticated();
  const held = await heldGrants(db, session, orgId, now);
  if (held.length === 0) throw booksErrors.noGrant();
  const [org] = await db
    .select({ id: orgs.id, displayName: orgs.displayName, ownerWallet: users.wallet })
    .from(orgs)
    .innerJoin(users, eq(users.id, orgs.ownerUserId))
    .where(eq(orgs.id, orgId))
    .limit(1);
  if (!org) throw apiErrors.forbidden();
  const granters = await db
    .select({ id: users.id, name: users.displayName, wallet: users.wallet })
    .from(users)
    .where(
      inArray(
        users.id,
        held.map((grant) => grant.createdBy),
      ),
    );
  const ids = await heldPaymentIds(
    db,
    session,
    orgId,
    held.map((grant) => grant.id),
  );
  const rows = ids.length
    ? await db
        .select({
          payment: payments,
          wallet: recipients.wallet,
          runTitle: payrollRuns.title,
        })
        .from(payments)
        .innerJoin(recipients, eq(recipients.id, payments.recipientId))
        .leftJoin(payrollRuns, eq(payrollRuns.id, payments.runId))
        .where(and(eq(payments.orgId, orgId), inArray(payments.id, ids)))
    : [];
  const paymentIds = rows.map((row) => row.payment.id);
  const [attempts, marks, approvalRows] = await Promise.all([
    paymentIds.length
      ? db
          .select({
            paymentId: paymentAttempts.paymentId,
            transferSignature: paymentAttempts.transferSignature,
          })
          .from(paymentAttempts)
          .where(
            and(
              inArray(paymentAttempts.paymentId, paymentIds),
              eq(paymentAttempts.status, "finalized"),
              isNotNull(paymentAttempts.transferSignature),
            ),
          )
      : Promise.resolve([]),
    paymentIds.length
      ? db.select().from(reconciliations).where(inArray(reconciliations.paymentId, paymentIds))
      : Promise.resolve([]),
    paymentIds.length
      ? db
          .select({
            subjectType: approvals.subjectType,
            subjectId: approvals.subjectId,
            createdAt: approvals.createdAt,
            name: users.displayName,
            wallet: users.wallet,
          })
          .from(approvals)
          .innerJoin(users, eq(users.id, approvals.approverUserId))
          .where(
            and(
              eq(approvals.orgId, orgId),
              eq(approvals.kind, "execution"),
              or(
                and(eq(approvals.subjectType, "payment"), inArray(approvals.subjectId, paymentIds)),
                and(
                  eq(approvals.subjectType, "payroll_run"),
                  inArray(approvals.subjectId, [
                    ...new Set(
                      rows.flatMap((row) => (row.payment.runId ? [row.payment.runId] : [])),
                    ),
                  ]),
                ),
              ),
            ),
          )
      : Promise.resolve([]),
  ]);
  const signatures = attempts.flatMap((attempt) =>
    attempt.transferSignature ? [attempt.transferSignature] : [],
  );
  const transfers = signatures.length
    ? await db
        .select()
        .from(chainActivity)
        .where(
          and(
            eq(chainActivity.orgId, orgId),
            eq(chainActivity.instructionType, "transfer_out"),
            inArray(chainActivity.signature, signatures),
          ),
        )
    : [];
  const payments_: BooksPaymentView[] = [];
  for (const row of rows) {
    const payment = row.payment;
    const signature =
      attempts.find((attempt) => attempt.paymentId === payment.id)?.transferSignature ?? null;
    const transfer = signature ? transfers.find((entry) => entry.signature === signature) : null;
    const [screened] = await db
      .select({ result: screenings.result })
      .from(screenings)
      .where(
        and(
          eq(screenings.orgId, orgId),
          eq(screenings.wallet, row.wallet),
          lte(screenings.createdAt, payment.settledAt ?? payment.updatedAt),
        ),
      )
      .orderBy(desc(screenings.createdAt))
      .limit(1);
    const approval = approvalRows.find((entry) =>
      payment.runId
        ? entry.subjectType === "payroll_run" && entry.subjectId === payment.runId
        : entry.subjectType === "payment" && entry.subjectId === payment.id,
    );
    const mark = marks.find((entry) => entry.paymentId === payment.id);
    payments_.push({
      id: payment.id,
      kind: payment.kind,
      status: payment.status,
      settledAt: payment.settledAt?.toISOString() ?? null,
      run:
        payment.runId && row.runTitle !== null ? { id: payment.runId, title: row.runTitle } : null,
      chain:
        transfer && transfer.counterpartyAddress
          ? {
              signature: transfer.signature,
              from: transfer.tokenAccount,
              to: transfer.counterpartyAddress,
              blockTime: transfer.blockTime?.toISOString() ?? null,
            }
          : null,
      screening: screened?.result ?? null,
      approvedBy: approval
        ? { name: approval.name, wallet: approval.wallet, at: approval.createdAt.toISOString() }
        : null,
      reconciliation: mark
        ? { status: mark.status, updatedAt: mark.updatedAt.toISOString() }
        : null,
    });
  }
  return {
    org: { id: org.id, displayName: org.displayName },
    ownerWallet: org.ownerWallet,
    grants: held.map((grant) => {
      const granter = granters.find((user) => user.id === grant.createdBy);
      return {
        id: grant.id,
        scope: grant.scope as BooksGrantView["scope"],
        periodFrom: grant.periodFrom,
        periodTo: grant.periodTo,
        expiresAt: grant.expiresAt?.toISOString() ?? null,
        activatedAt: grant.activatedAt?.toISOString() ?? null,
        grantedBy: { name: granter?.name ?? null, wallet: granter?.wallet ?? org.ownerWallet },
      };
    }),
    payments: payments_,
  };
}

export const reconciliationSchema = z
  .object({ status: z.enum(["matched", "needs_receipt"]) })
  .strict();

/**
 * AC-11.3: the status of a payment the caller may read: an accountant holding its record under a
 * readable grant, or the org's owner.
 */
export async function setReconciliation(
  db: Database,
  session: Session | null,
  orgId: string,
  paymentId: string,
  input: z.infer<typeof reconciliationSchema>,
  now = new Date(),
): Promise<{ status: "matched" | "needs_receipt"; updatedAt: string }> {
  const { roles } = await requireMoneyAccess(db, session, orgId, ["owner", "accountant"]);
  if (!session) throw apiErrors.unauthenticated();
  if (!UUID.test(paymentId)) throw booksErrors.paymentNotFound();
  const [payment] = await db
    .select({ id: payments.id })
    .from(payments)
    .where(and(eq(payments.id, paymentId), eq(payments.orgId, orgId)))
    .limit(1);
  if (!payment) throw booksErrors.paymentNotFound();
  if (!roles.includes("owner")) {
    const held = await heldGrants(db, session, orgId, now);
    const ids = await heldPaymentIds(
      db,
      session,
      orgId,
      held.map((grant) => grant.id),
    );
    if (!ids.includes(paymentId)) throw booksErrors.paymentNotFound();
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(reconciliations)
      .values({ paymentId, orgId, status: input.status, updatedBy: session.userId, updatedAt: now })
      .onConflictDoUpdate({
        target: reconciliations.paymentId,
        set: { status: input.status, updatedBy: session.userId, updatedAt: now },
      })
      .returning();
    if (!row) throw apiErrors.internal();
    await insertAccessEvent(tx, {
      orgId,
      actorUserId: session.userId,
      action: "reconciliation_updated",
      subjectType: "payment",
      subjectId: paymentId,
      metadata: { status: input.status },
    });
    return { status: row.status, updatedAt: row.updatedAt.toISOString() };
  });
}

export const exportSchema = z
  .object({
    grantId: z.uuid(),
    rows: z.number().int().min(0).max(100_000),
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/)
      .nullable(),
    category: z.enum(["payroll", "supplier", "revenue", "payouts", "software", "other"]).nullable(),
    needsReceipt: z.boolean(),
    /** Whether a search narrowed the rows; the search text itself never leaves the tab (I-2). */
    searched: z.boolean(),
  })
  .strict();

/** AC-11.4: the export event of a CSV the accountant's tab generated, metadata only. */
export async function recordExport(
  db: Database,
  session: Session | null,
  orgId: string,
  input: z.infer<typeof exportSchema>,
  now = new Date(),
): Promise<{ recorded: true }> {
  await requireMoneyAccess(db, session, orgId, ["accountant"]);
  if (!session) throw apiErrors.unauthenticated();
  const grant = (await heldGrants(db, session, orgId, now)).find((row) => row.id === input.grantId);
  if (!grant) throw booksErrors.noGrant();
  await insertAccessEvent(db, {
    orgId,
    actorUserId: session.userId,
    action: "export_created",
    subjectType: "export",
    subjectId: grant.id,
    metadata: {
      rows: input.rows,
      scope: grant.scope,
      periodFrom: grant.periodFrom,
      periodTo: grant.periodTo,
      month: input.month,
      category: input.category,
      needsReceipt: input.needsReceipt,
      searched: input.searched,
    },
  });
  return { recorded: true };
}
