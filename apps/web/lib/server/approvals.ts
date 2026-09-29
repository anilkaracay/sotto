// Approval messages (D-04, Q-11, Q-12 (a); 08 section 3; step 1.9). POST /approvals stores an
// approver's wallet signature over the approval message of a payment or, since step 2.3, a payroll
// run: the org, the cluster, the subject and the contents hash of its lines as they are now. The
// approver is an owner or approver of the org other than the initiator (whose execution is their
// approval), and the subject has not started executing. A message over older contents is refused,
// and approving again replaces the earlier signature. Policies above 1 cannot be set in the hackathon
// build (Q-12), so this path is exercised through the API and its tests; the approver screen is
// Post-hackathon.
import { approvals, insertAccessEvent, payments, recipients, type Database } from "@sotto/db";
import { approvalMessage } from "@sotto/sdk/approvals";
import { verifyWalletSignature } from "@sotto/sdk/keys/public";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { ServerCluster } from "./cluster.ts";
import { ApiError, apiErrors } from "./errors.ts";
import { requireMoneyAccess } from "./orgs.ts";
import { paymentContentsHash, paymentErrors } from "./payments.ts";
import { currentRunApprovalMessage, payrollErrors } from "./payroll.ts";
import type { Session } from "./session.ts";

export const approvalSchema = z
  .object({
    subjectType: z.enum(["payment", "payroll_run"]),
    subjectId: z.uuid(),
    message: z.string().min(1).max(1000),
    signature: z
      .string()
      .regex(/^[A-Za-z0-9+/]*={0,2}$/, "must be base64")
      .refine((value) => Buffer.from(value, "base64").length === 64, "must be 64 bytes in base64"),
  })
  .strict();

export const approvalErrors = {
  initiator: () =>
    new ApiError(
      409,
      "approval_by_initiator",
      "The initiator's execution is their approval; another member must approve",
    ),
  messageMismatch: () =>
    new ApiError(
      422,
      "approval_message_mismatch",
      "The message does not match this payment's current contents",
    ),
  signatureInvalid: () =>
    new ApiError(
      422,
      "approval_signature_invalid",
      "The signature is not your wallet's signature of the message",
    ),
};

async function storeApproval(
  db: Database,
  input: { orgId: string; subjectType: "payment" | "payroll_run"; subjectId: string },
  session: Session,
  message: string,
  signature: Buffer,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(approvals)
      .values({
        orgId: input.orgId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        approverUserId: session.userId,
        kind: "message",
        message,
        signature,
      })
      .onConflictDoUpdate({
        target: [approvals.subjectType, approvals.subjectId, approvals.approverUserId],
        set: { message, signature, kind: "message", createdAt: new Date() },
        where: and(eq(approvals.kind, "message")),
      });
    // AC-14.1: an approval, metadata only, with the approval it records.
    await insertAccessEvent(tx, {
      orgId: input.orgId,
      actorUserId: session.userId,
      action: "approval_recorded",
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      metadata: { kind: "message" },
    });
  });
}

async function checkSignature(session: Session, message: string, encoded: string): Promise<Buffer> {
  const signature = Buffer.from(encoded, "base64");
  const valid = await verifyWalletSignature(
    session.wallet,
    new TextEncoder().encode(message),
    new Uint8Array(signature),
  );
  if (!valid) throw approvalErrors.signatureInvalid();
  return signature;
}

export async function recordApproval(
  db: Database,
  session: Session | null,
  input: z.infer<typeof approvalSchema>,
  cluster: ServerCluster | null,
): Promise<{ approval: { subjectType: "payment" | "payroll_run"; subjectId: string } }> {
  if (!session) throw apiErrors.unauthenticated();
  if (input.subjectType === "payroll_run") {
    if (!cluster) throw paymentErrors.confidentialUnavailable();
    const { run, message } = await currentRunApprovalMessage(db, input.subjectId, cluster).catch(
      (error: unknown) => {
        throw error instanceof ApiError ? error : payrollErrors.notFound();
      },
    );
    await requireMoneyAccess(db, session, run.orgId, ["owner", "approver"]);
    if (run.createdBy === session.userId) throw approvalErrors.initiator();
    if (!["draft", "awaiting_approval", "approved"].includes(run.status)) {
      throw payrollErrors.status(run.status);
    }
    if (input.message !== message) throw approvalErrors.messageMismatch();
    const signature = await checkSignature(session, input.message, input.signature);
    await storeApproval(
      db,
      { orgId: run.orgId, subjectType: "payroll_run", subjectId: run.id },
      session,
      input.message,
      signature,
    );
    return { approval: { subjectType: "payroll_run", subjectId: run.id } };
  }
  const [row] = await db
    .select({ payment: payments, wallet: recipients.wallet })
    .from(payments)
    .innerJoin(recipients, eq(recipients.id, payments.recipientId))
    .where(and(eq(payments.id, input.subjectId), eq(payments.kind, "single")))
    .limit(1);
  // An unknown payment and one of another org look the same: 403 from the gate, or 404 here.
  if (!row) throw paymentErrors.notFound();
  const { payment } = row;
  await requireMoneyAccess(db, session, payment.orgId, ["owner", "approver"]);
  if (payment.createdBy === session.userId) throw approvalErrors.initiator();
  if (payment.status !== "draft" && payment.status !== "authorized") {
    throw paymentErrors.status(payment.status);
  }
  if (!cluster) throw paymentErrors.confidentialUnavailable();
  const expected = approvalMessage({
    orgId: payment.orgId,
    cluster: cluster.config.name,
    subjectType: "payment",
    subjectId: payment.id,
    contentsHash: await paymentContentsHash(payment, row.wallet),
  });
  if (input.message !== expected) throw approvalErrors.messageMismatch();
  const signature = await checkSignature(session, input.message, input.signature);
  await storeApproval(
    db,
    { orgId: payment.orgId, subjectType: "payment", subjectId: payment.id },
    session,
    input.message,
    signature,
  );
  return { approval: { subjectType: "payment", subjectId: payment.id } };
}
