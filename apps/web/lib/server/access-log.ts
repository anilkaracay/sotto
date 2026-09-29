// The access log (F-14, AC-14.1, AC-10.5; step 2.4): the owner reads what happened in the org, newest
// first. Every row is metadata only (the writer in @sotto/db refuses amount like keys); the labels the
// page shows come from the rows' subjects at read time: a grant's holder (also for an export, whose
// subject is the grant it was made under, step 2.5), a payment's recipient, a run's title.
import {
  accessLog,
  grants,
  payments,
  payrollRuns,
  recipients,
  users,
  type Database,
} from "@sotto/db";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireMoneyAccess } from "./orgs.ts";
import type { Session } from "./session.ts";

export const accessLogQuerySchema = z
  .object({ days: z.coerce.number().int().min(1).max(90).default(7) })
  .strict();

export type AccessEventView = {
  id: string;
  action: string;
  actor: { userId: string; displayName: string | null; wallet: string } | null;
  subject: { type: string; id: string; label: string | null };
  metadata: Record<string, unknown>;
  createdAt: string;
};

export async function listAccessLog(
  db: Database,
  session: Session | null,
  orgId: string,
  days: number,
  now = new Date(),
): Promise<AccessEventView[]> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  const rows = await db
    .select({
      event: accessLog,
      actorName: users.displayName,
      actorWallet: users.wallet,
    })
    .from(accessLog)
    .leftJoin(users, eq(users.id, accessLog.actorUserId))
    .where(
      and(
        eq(accessLog.orgId, orgId),
        gte(accessLog.createdAt, new Date(now.getTime() - days * 24 * 60 * 60 * 1000)),
      ),
    )
    .orderBy(desc(accessLog.createdAt), desc(accessLog.id))
    .limit(100);
  const ids = (type: string) => [
    ...new Set(
      rows.filter((row) => row.event.subjectType === type).map((row) => row.event.subjectId),
    ),
  ];
  const [grantLabels, paymentLabels, runLabels] = await Promise.all([
    [...ids("grant"), ...ids("export")].length
      ? db
          .select({
            id: grants.id,
            holderName: grants.holderName,
            recipientName: recipients.displayName,
          })
          .from(grants)
          .leftJoin(
            recipients,
            and(eq(recipients.orgId, grants.orgId), eq(recipients.userId, grants.viewerUserId)),
          )
          .where(
            and(eq(grants.orgId, orgId), inArray(grants.id, [...ids("grant"), ...ids("export")])),
          )
      : Promise.resolve([]),
    ids("payment").length
      ? db
          .select({ id: payments.id, name: recipients.displayName })
          .from(payments)
          .innerJoin(recipients, eq(recipients.id, payments.recipientId))
          .where(and(eq(payments.orgId, orgId), inArray(payments.id, ids("payment"))))
      : Promise.resolve([]),
    ids("payroll_run").length
      ? db
          .select({ id: payrollRuns.id, title: payrollRuns.title })
          .from(payrollRuns)
          .where(and(eq(payrollRuns.orgId, orgId), inArray(payrollRuns.id, ids("payroll_run"))))
      : Promise.resolve([]),
  ]);
  const label = (type: string, id: string): string | null => {
    if (type === "grant" || type === "export") {
      const grant = grantLabels.find((row) => row.id === id);
      return grant?.holderName ?? grant?.recipientName ?? null;
    }
    if (type === "payment") return paymentLabels.find((row) => row.id === id)?.name ?? null;
    if (type === "payroll_run") return runLabels.find((row) => row.id === id)?.title ?? null;
    return null;
  };
  return rows.map(({ event, actorName, actorWallet }) => ({
    id: event.id.toString(),
    action: event.action,
    actor:
      event.actorUserId && actorWallet
        ? { userId: event.actorUserId, displayName: actorName, wallet: actorWallet }
        : null,
    subject: {
      type: event.subjectType,
      id: event.subjectId,
      label: label(event.subjectType, event.subjectId),
    },
    metadata: event.metadata as Record<string, unknown>,
    createdAt: event.createdAt.toISOString(),
  }));
}
