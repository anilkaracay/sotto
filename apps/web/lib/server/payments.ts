// Single payments (F-06, 06 section 5, 08 section 3; step 1.9). Money endpoints (requireMoneyAccess,
// AC-02.2). A payment holds no amount: the amount and memo are a private blob sealed in the owner's
// browser to the owner's viewing key, and the transfer publishes only ciphertexts.
// - create: a draft for one recipient with a client made idempotency key (the same key returns the
//   same draft, I-7);
// - authorize (AC-06.2, AC-06.3): the organization is active (the gate), the recipient's account is
//   read from chain right now and must be ready (founder, step 1.8 choice 6), the wallet is screened
//   clear within 24 hours (D-10), the approvals meet the policy (D-04, Q-11: the initiator's execution
//   counts as one, the rest are signed messages over the current contents hash), and the proof
//   program verified a proof recently (F-19). A retry after a failed attempt first checks chain
//   state for that attempt's transfer signature, so a transfer that landed is never sent again;
// - executions: the signatures of each attempt, recorded before each transaction is sent, with the
//   transfer transaction marked; with the first signature the initiator's approval is recorded (Q-11).
//   The worker's confirm-executions job settles the payment when the transfer is finalized.
import {
  approvals,
  clusterHealth,
  orgPolicy,
  paymentAttempts,
  payments,
  recipients,
  type Database,
} from "@sotto/db";
import { approvalMessage, contentsHash } from "@sotto/sdk/approvals";
import { sha256Hex } from "@sotto/sdk/disclosure";
import type { SolanaRpc } from "@sotto/sdk/tx";
import { and, asc, desc, eq, gt, inArray, isNotNull, ne } from "drizzle-orm";
import { z } from "zod";
import { payability } from "../recipient.ts";
import type { ServerCluster } from "./cluster.ts";
import { ApiError, apiErrors } from "./errors.ts";
import { log } from "./log.ts";
import { requireMoneyAccess } from "./orgs.ts";
import { readinessFromChain, recipientErrors } from "./recipients.ts";
import { readViewerKey } from "./viewer-keys.ts";
import { recentScreening, screeningProvider, screenWallet } from "./screening.ts";
import type { Session } from "./session.ts";

/** A proof program check older than this does not count (the job runs every 5 minutes). */
export const PROOF_PROGRAM_MAX_AGE_MS = 15 * 60 * 1000;

const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

const base64Of = (min: number, max: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, "must be base64")
    .refine((value) => {
      const bytes = Buffer.from(value, "base64");
      return bytes.length >= min && bytes.length <= max && bytes.toString("base64") === value;
    }, `must be ${min} to ${max} bytes in base64`);

export const paymentCreateSchema = z
  .object({
    recipientId: z.uuid(),
    idempotencyKey: z.uuid(),
    /** The amount and memo sealed to the owner's viewing key (07 section 2). */
    privateBlob: base64Of(48, 2048),
  })
  .strict();

const signature = z.string().regex(SIGNATURE, "must be a transaction signature");
const attemptNo = z.number().int().min(1).max(100);

export const executionSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("sent"),
      attemptNo,
      signature,
      /** The transaction holds the transfer instruction (the one that settles the payment). */
      transfer: z.boolean(),
    })
    .strict(),
  z
    .object({
      status: z.enum(["failed_clean", "failed"]),
      attemptNo,
      /** What failed, for the record: the step and a short code, never an amount. */
      errorCode: z.string().regex(/^[a-z0-9_:.-]{1,80}$/, "must be a short code"),
      signatures: z.array(signature).max(10).default([]),
    })
    .strict(),
  z.object({ status: z.literal("integrity"), ok: z.boolean() }).strict(),
]);

export const paymentErrors = {
  notFound: () => new ApiError(404, "payment_not_found", "Payment not found"),
  idempotencyConflict: () =>
    new ApiError(
      409,
      "payment_idempotency_conflict",
      "This idempotency key belongs to another payment",
    ),
  status: (status: string) =>
    new ApiError(409, "payment_status", `This payment is ${status.replace("_", " ")}`),
  recipientNotReady: (reason: string) => new ApiError(409, "recipient_not_ready", reason),
  readinessUnavailable: () =>
    new ApiError(
      503,
      "readiness_unavailable",
      "The recipient's account could not be read from the network",
    ),
  screeningHit: () =>
    new ApiError(
      422,
      "screening_hit",
      "The recipient's wallet is on the screening list, so the payment is blocked",
    ),
  screeningUnavailable: () =>
    new ApiError(
      503,
      "screening_unavailable",
      "Screening is not available on this network, so no payment can be authorized",
    ),
  approvalsMissing: (missing: number) =>
    new ApiError(
      409,
      "approvals_missing",
      `This payment needs ${missing} more ${missing === 1 ? "approval" : "approvals"}`,
    ),
  proofProgramUnavailable: () =>
    new ApiError(
      503,
      "proof_program_unavailable",
      "The proof program has not been confirmed available, so confidential payments are paused",
    ),
  confidentialUnavailable: () =>
    new ApiError(503, "confidential_unavailable", "Confidential payments are off on this network"),
  transferLanded: () =>
    new ApiError(
      409,
      "payment_transfer_landed",
      "The last attempt's transfer landed onchain; Sotto is confirming it, so it is not sent again",
    ),
};

export type PaymentView = {
  id: string;
  recipientId: string;
  recipient: { displayName: string; wallet: string };
  idempotencyKey: string;
  status: string;
  privateBlob: string | null;
  signatures: string[];
  settledSlot: string | null;
  errorCode: string | null;
  createdAt: string;
  attempts: {
    attemptNo: number;
    status: string;
    signatures: string[];
    transferSignature: string | null;
    errorCode: string | null;
  }[];
  /** D-04: the contents hash approvals sign, and the policy. */
  contentsHash: string | null;
  approvals: { required: number; messages: number };
};

type PaymentRow = typeof payments.$inferSelect;

async function paymentRow(db: Database, orgId: string, paymentId: string) {
  const [row] = await db
    .select({ payment: payments, recipientName: recipients.displayName, wallet: recipients.wallet })
    .from(payments)
    .innerJoin(recipients, eq(recipients.id, payments.recipientId))
    .where(and(eq(payments.id, paymentId), eq(payments.orgId, orgId)))
    .limit(1);
  if (!row) throw paymentErrors.notFound();
  return row;
}

/** D-04: one line, the payment itself. */
export async function paymentContentsHash(payment: PaymentRow, wallet: string): Promise<string> {
  if (!payment.privateBlob) throw new Error("a single payment has a private blob");
  return contentsHash([
    {
      line_id: payment.id,
      recipient_wallet: wallet,
      idempotency_key: payment.idempotencyKey,
      private_blob_sha256: await sha256Hex(new Uint8Array(payment.privateBlob)),
    },
  ]);
}

async function requiredApprovals(db: Database, orgId: string): Promise<number> {
  const [policy] = await db
    .select({ required: orgPolicy.paymentApprovalsRequired })
    .from(orgPolicy)
    .where(eq(orgPolicy.orgId, orgId))
    .limit(1);
  return policy?.required ?? 1;
}

/** Signed approval messages over the current contents, from members other than the initiator. */
async function messageApprovals(
  db: Database,
  payment: PaymentRow,
  expectedMessage: string,
): Promise<number> {
  const rows = await db
    .select({ message: approvals.message })
    .from(approvals)
    .where(
      and(
        eq(approvals.subjectType, "payment"),
        eq(approvals.subjectId, payment.id),
        eq(approvals.kind, "message"),
        ne(approvals.approverUserId, payment.createdBy),
      ),
    );
  return rows.filter((row) => row.message === expectedMessage).length;
}

async function view(
  db: Database,
  orgId: string,
  row: Awaited<ReturnType<typeof paymentRow>>,
  cluster: ServerCluster | null,
): Promise<PaymentView> {
  const { payment } = row;
  const attempts = await db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.paymentId, payment.id))
    .orderBy(asc(paymentAttempts.attemptNo));
  const hash = payment.privateBlob ? await paymentContentsHash(payment, row.wallet) : null;
  const required = await requiredApprovals(db, orgId);
  const messages =
    hash && cluster
      ? await messageApprovals(
          db,
          payment,
          approvalMessage({
            orgId,
            cluster: cluster.config.name,
            subjectType: "payment",
            subjectId: payment.id,
            contentsHash: hash,
          }),
        )
      : 0;
  return {
    id: payment.id,
    recipientId: payment.recipientId,
    recipient: { displayName: row.recipientName, wallet: row.wallet },
    idempotencyKey: payment.idempotencyKey,
    status: payment.status,
    privateBlob: payment.privateBlob ? Buffer.from(payment.privateBlob).toString("base64") : null,
    signatures: payment.signatures,
    settledSlot: payment.settledSlot?.toString() ?? null,
    errorCode: payment.errorCode,
    createdAt: payment.createdAt.toISOString(),
    attempts: attempts.map((attempt) => ({
      attemptNo: attempt.attemptNo,
      status: attempt.status,
      signatures: attempt.signatures,
      transferSignature: attempt.transferSignature,
      errorCode: attempt.errorCode,
    })),
    contentsHash: hash,
    approvals: { required, messages },
  };
}

export async function createPayment(
  db: Database,
  session: Session | null,
  orgId: string,
  input: z.infer<typeof paymentCreateSchema>,
  cluster: ServerCluster | null,
): Promise<{ payment: PaymentView; created: boolean }> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  if (!session) throw apiErrors.unauthenticated();
  const [recipient] = await db
    .select({ id: recipients.id })
    .from(recipients)
    .where(and(eq(recipients.id, input.recipientId), eq(recipients.orgId, orgId)))
    .limit(1);
  if (!recipient) throw recipientErrors.notFound();
  const blob = Buffer.from(input.privateBlob, "base64");
  const inserted = await db
    .insert(payments)
    .values({
      orgId,
      kind: "single",
      recipientId: recipient.id,
      idempotencyKey: input.idempotencyKey,
      createdBy: session.userId,
      privateBlob: blob,
    })
    .onConflictDoNothing({ target: payments.idempotencyKey })
    .returning({ id: payments.id });
  if (inserted[0]) {
    return {
      payment: await view(db, orgId, await paymentRow(db, orgId, inserted[0].id), cluster),
      created: true,
    };
  }
  // I-7: the same key returns the same draft; another payment's key is refused.
  const [existing] = await db
    .select()
    .from(payments)
    .where(eq(payments.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (
    !existing ||
    existing.orgId !== orgId ||
    existing.recipientId !== recipient.id ||
    !existing.privateBlob ||
    !Buffer.from(existing.privateBlob).equals(blob)
  ) {
    throw paymentErrors.idempotencyConflict();
  }
  return {
    payment: await view(db, orgId, await paymentRow(db, orgId, existing.id), cluster),
    created: false,
  };
}

export async function readPayment(
  db: Database,
  session: Session | null,
  orgId: string,
  paymentId: string,
  cluster: ServerCluster | null,
): Promise<PaymentView> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  return view(db, orgId, await paymentRow(db, orgId, paymentId), cluster);
}

/** The org's payments, newest first, at most 100 (the payments page lists them). */
export async function listPayments(
  db: Database,
  session: Session | null,
  orgId: string,
  cluster: ServerCluster | null,
): Promise<PaymentView[]> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  const rows = await db
    .select({ payment: payments, recipientName: recipients.displayName, wallet: recipients.wallet })
    .from(payments)
    .innerJoin(recipients, eq(recipients.id, payments.recipientId))
    .where(and(eq(payments.orgId, orgId), eq(payments.kind, "single")))
    .orderBy(desc(payments.createdAt))
    .limit(100);
  return Promise.all(rows.map((row) => view(db, orgId, row, cluster)));
}

export type ViewerKeyRecord = {
  userId: string;
  wallet: string;
  publicKey: string;
  signature: string;
};

/**
 * The registered viewing keys of the org's recipients who joined (for their recipient disclosures,
 * AC-06.4), by recipient id. The page verifies each registration signature before it seals to a key
 * (I-8); a recipient without a key gets no disclosure.
 */
export async function recipientViewerKeys(
  db: Database,
  session: Session,
  orgId: string,
): Promise<Record<string, ViewerKeyRecord>> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  const joined = await db
    .select({ id: recipients.id, userId: recipients.userId })
    .from(recipients)
    .where(and(eq(recipients.orgId, orgId), isNotNull(recipients.userId)));
  const keys: Record<string, ViewerKeyRecord> = {};
  for (const row of joined) {
    if (!row.userId) continue;
    try {
      const key = await readViewerKey(db, session, row.userId);
      keys[row.id] = {
        userId: key.userId,
        wallet: key.wallet,
        publicKey: key.publicKey,
        signature: key.signature,
      };
    } catch (error) {
      if (error instanceof ApiError && (error.status === 404 || error.status === 403)) continue;
      throw error;
    }
  }
  return keys;
}

/** The transfer signatures of earlier attempts that landed without an error, if any. */
async function landedTransfers(db: Database, rpc: SolanaRpc, paymentId: string): Promise<boolean> {
  const attempts = await db
    .select({ transferSignature: paymentAttempts.transferSignature })
    .from(paymentAttempts)
    .where(eq(paymentAttempts.paymentId, paymentId));
  const sent = attempts.flatMap((attempt) =>
    attempt.transferSignature ? [attempt.transferSignature] : [],
  );
  if (sent.length === 0) return false;
  const { value } = await rpc
    .getSignatureStatuses(sent as never, { searchTransactionHistory: true })
    .send();
  return value.some((status) => status !== null && status.err === null);
}

export async function authorizePayment(
  db: Database,
  session: Session | null,
  orgId: string,
  paymentId: string,
  chain: { rpc: SolanaRpc; cluster: ServerCluster | null },
  now = new Date(),
): Promise<PaymentView> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  const row = await paymentRow(db, orgId, paymentId);
  const { payment } = row;
  if (!["draft", "authorized", "failed_clean"].includes(payment.status)) {
    throw paymentErrors.status(payment.status);
  }
  const cluster = chain.cluster;
  if (!cluster?.wrappedUsdcMint) throw paymentErrors.confidentialUnavailable();

  // I-7: never send again a transfer that landed; the job settles it.
  if (payment.status === "failed_clean" && (await landedTransfers(db, chain.rpc, payment.id))) {
    await db
      .update(payments)
      .set({ status: "executing", updatedAt: now })
      .where(eq(payments.id, payment.id));
    throw paymentErrors.transferLanded();
  }

  // The recipient's account, read from chain right before the payment (step 1.8 choice 6).
  const readiness = await readinessFromChain(chain.rpc, cluster, row.wallet);
  if (readiness === null) throw paymentErrors.readinessUnavailable();
  await db
    .update(recipients)
    .set({ readiness, readinessCheckedAt: now })
    .where(eq(recipients.id, payment.recipientId));
  if (readiness !== "ready") throw paymentErrors.recipientNotReady(payability(readiness).reason);

  // D-10, AC-06.2: a clear result within 24 hours, or a new screening now; a hit blocks.
  let screening = await recentScreening(db, orgId, row.wallet, now);
  if (screening === null || screening === "error") {
    screening = await screenWallet(db, orgId, row.wallet, screeningProvider(cluster.config.name));
  }
  if (screening === "hit") {
    // Recorded on the payment, so the page shows it blocked and offers no retry.
    await db
      .update(payments)
      .set({ errorCode: "screening_hit", updatedAt: now })
      .where(eq(payments.id, payment.id));
    log("warn", "payment_blocked_by_screening", { orgId, paymentId: payment.id });
    throw paymentErrors.screeningHit();
  }
  if (screening === "error") throw paymentErrors.screeningUnavailable();

  // D-04, Q-11: the initiator's execution is one approval; the others are signed messages.
  const hash = await paymentContentsHash(payment, row.wallet);
  const required = await requiredApprovals(db, orgId);
  const signed = await messageApprovals(
    db,
    payment,
    approvalMessage({
      orgId,
      cluster: cluster.config.name,
      subjectType: "payment",
      subjectId: payment.id,
      contentsHash: hash,
    }),
  );
  const missing = required - 1 - signed;
  if (missing > 0) throw paymentErrors.approvalsMissing(missing);

  // F-19: a recent successful proof verification on this cluster.
  const [health] = await db
    .select()
    .from(clusterHealth)
    .where(
      and(
        eq(clusterHealth.cluster, cluster.config.name),
        gt(clusterHealth.checkedAt, new Date(now.getTime() - PROOF_PROGRAM_MAX_AGE_MS)),
      ),
    )
    .limit(1);
  if (!health?.proofProgramOk) throw paymentErrors.proofProgramUnavailable();

  await db
    .update(payments)
    .set({ status: "authorized", errorCode: null, updatedAt: now })
    .where(
      and(
        eq(payments.id, payment.id),
        inArray(payments.status, ["draft", "authorized", "failed_clean"]),
      ),
    );
  return view(db, orgId, await paymentRow(db, orgId, paymentId), cluster);
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type AttemptInput = Exclude<z.infer<typeof executionSchema>, { status: "integrity" }>;

/**
 * The attempt part of an execution record (08 section 3), shared by single payments and, since step
 * 2.3, payroll lines: a signature opens the next attempt of an authorized payment or joins its open
 * attempt, and the end of an attempt records how it ended. The payment row is locked meanwhile.
 */
export async function applyAttempt(
  tx: Transaction,
  paymentId: string,
  input: AttemptInput,
  now: Date,
): Promise<void> {
  const [current] = await tx
    .select({ status: payments.status })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .for("update");
  if (!current) throw paymentErrors.notFound();
  const status = current.status;
  const [attempt] = await tx
    .select()
    .from(paymentAttempts)
    .where(
      and(eq(paymentAttempts.paymentId, paymentId), eq(paymentAttempts.attemptNo, input.attemptNo)),
    )
    .limit(1);
  const [latest] = await tx
    .select({ attemptNo: paymentAttempts.attemptNo })
    .from(paymentAttempts)
    .where(eq(paymentAttempts.paymentId, paymentId))
    .orderBy(desc(paymentAttempts.attemptNo))
    .limit(1);

  if (input.status === "sent") {
    const opening = !attempt;
    // A new attempt starts only after authorization, as the next number.
    if (opening && (status !== "authorized" || input.attemptNo !== (latest?.attemptNo ?? 0) + 1)) {
      throw paymentErrors.status(status);
    }
    if (!opening && status !== "executing") throw paymentErrors.status(status);
    if (opening) {
      await tx.insert(paymentAttempts).values({
        paymentId,
        attemptNo: input.attemptNo,
        signatures: [input.signature],
        status: "sent",
        transferSignature: input.transfer ? input.signature : null,
      });
    } else if (!attempt.signatures.includes(input.signature)) {
      await tx
        .update(paymentAttempts)
        .set({
          signatures: [...attempt.signatures, input.signature],
          ...(input.transfer ? { transferSignature: input.signature } : {}),
        })
        .where(eq(paymentAttempts.id, attempt.id));
    }
    await tx
      .update(payments)
      .set({ status: "executing", updatedAt: now })
      .where(eq(payments.id, paymentId));
    return;
  }

  // failed_clean or failed: the client stopped the attempt (and closed its proof accounts).
  if (!attempt || !["executing", "failed", "authorized"].includes(status)) {
    throw paymentErrors.status(status);
  }
  await tx
    .update(paymentAttempts)
    .set({
      status: input.status,
      errorCode: input.errorCode,
      signatures: [...new Set([...attempt.signatures, ...input.signatures])],
    })
    .where(eq(paymentAttempts.id, attempt.id));
  await tx
    .update(payments)
    .set({ status: input.status, errorCode: input.errorCode, updatedAt: now })
    .where(eq(payments.id, paymentId));
}

export async function recordExecution(
  db: Database,
  session: Session | null,
  orgId: string,
  paymentId: string,
  input: z.infer<typeof executionSchema>,
  cluster: ServerCluster | null,
  now = new Date(),
): Promise<PaymentView> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  if (!session) throw apiErrors.unauthenticated();
  const row = await paymentRow(db, orgId, paymentId);
  const { payment } = row;

  if (input.status === "integrity") {
    // 06 section 5 step 5: the sender's new available balance against the previous one.
    log(
      input.ok ? "info" : "error",
      input.ok ? "payment_integrity_ok" : "payment_integrity_alert",
      {
        orgId,
        paymentId,
      },
    );
    return view(db, orgId, row, cluster);
  }

  await db.transaction(async (tx) => {
    await applyAttempt(tx, payment.id, input, now);
    if (input.status !== "sent") return;
    // Q-11: the initiator's execution is their approval, with the first execution signature.
    await tx
      .insert(approvals)
      .values({
        orgId,
        subjectType: "payment",
        subjectId: payment.id,
        approverUserId: session.userId,
        kind: "execution",
        executionSignature: input.signature,
      })
      .onConflictDoNothing({
        target: [approvals.subjectType, approvals.subjectId, approvals.approverUserId],
      });
  });
  return view(db, orgId, await paymentRow(db, orgId, paymentId), cluster);
}
