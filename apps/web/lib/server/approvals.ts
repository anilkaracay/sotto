// Approval messages (D-04, Q-11, Q-12 (a); 08 section 3; step 1.9). POST /approvals stores an
// approver's wallet signature over the approval message of a payment: the org, the cluster, the
// subject and the contents hash of the payment as it is now. The approver is an owner or approver of
// the org other than the initiator (whose execution is their approval), and the payment has not
// started executing. A message over older contents is refused, and approving again replaces the
// earlier signature. Policies above 1 cannot be set in the hackathon build (Q-12), so this path is
// exercised through the API and its tests; the approver screen is Post-hackathon.
import { approvals, payments, recipients, type Database } from "@sotto/db";
import { approvalMessage } from "@sotto/sdk/approvals";
import { verifyWalletSignature } from "@sotto/sdk/keys/public";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { ServerCluster } from "./cluster.ts";
import { ApiError, apiErrors } from "./errors.ts";
import { requireMoneyAccess } from "./orgs.ts";
import { paymentContentsHash, paymentErrors } from "./payments.ts";
import type { Session } from "./session.ts";

export const approvalSchema = z
  .object({
    /** Payroll runs join in Phase 2 (F-08). */
    subjectType: z.literal("payment"),
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

export async function recordApproval(
  db: Database,
  session: Session | null,
  input: z.infer<typeof approvalSchema>,
  cluster: ServerCluster | null,
): Promise<{ approval: { subjectType: "payment"; subjectId: string } }> {
  if (!session) throw apiErrors.unauthenticated();
  const [row] = await db
    .select({ payment: payments, wallet: recipients.wallet })
    .from(payments)
    .innerJoin(recipients, eq(recipients.id, payments.recipientId))
    .where(eq(payments.id, input.subjectId))
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
  const signature = Buffer.from(input.signature, "base64");
  const valid = await verifyWalletSignature(
    session.wallet,
    new TextEncoder().encode(input.message),
    new Uint8Array(signature),
  );
  if (!valid) throw approvalErrors.signatureInvalid();
  await db
    .insert(approvals)
    .values({
      orgId: payment.orgId,
      subjectType: "payment",
      subjectId: payment.id,
      approverUserId: session.userId,
      kind: "message",
      message: input.message,
      signature,
    })
    .onConflictDoUpdate({
      target: [approvals.subjectType, approvals.subjectId, approvals.approverUserId],
      set: { message: input.message, signature, kind: "message", createdAt: new Date() },
      where: and(eq(approvals.kind, "message")),
    });
  return { approval: { subjectType: "payment", subjectId: payment.id } };
}
