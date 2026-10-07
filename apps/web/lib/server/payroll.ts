// Payroll runs (F-08, 06 section 7, 08 section 3; step 2.3). Money endpoints (requireMoneyAccess,
// owner). A run holds no amount: each line is a payment of kind payroll_line whose amount, memo, gross
// and tax are the line's own private blob, sealed in the owner's browser to the owner's viewing key.
// - create (AC-08.1): a draft run of recipients of the org, one line per recipient, with a client made
//   idempotency key for the run and for each line, stored before anything is signed (I-7);
// - authorize (AC-08.2, D-04): a resume first reads the chain for every earlier transfer
//   signature of the lines not settled, and a line whose transfer landed is left to the job to settle,
//   never sent again (AC-08.5). Every other line not settled is checked like a single payment: the
//   recipient's account read from chain now, screening within 24 hours (D-10). A line that fails is
//   marked with its reason and the whole run is refused before anything is signed. Then the approvals
//   (the initiator's execution counts as one, the others are signed messages over the run's contents
//   hash) and the proof program (F-19);
// - executions per line: each signature before its transaction is sent, the end of a stopped attempt;
//   with the first signature of the run it becomes executing and the initiator's approval is recorded
//   with that execution signature;
// - stop: the page ended the execution before every line landed; the run becomes partially settled
//   (some line landed) or failed (none did), and can be resumed. The worker's confirm-executions job
//   settles lines at finality and the run once every line is settled.
import {
  approvals,
  clusterHealth,
  disclosures,
  grants,
  insertAccessEvent,
  orgPolicy,
  paymentAttempts,
  payments,
  payrollRuns,
  recipients,
  users,
  type Database,
} from "@sotto/db";
import { approvalMessage, contentsHash } from "@sotto/sdk/approvals";
import {
  associatedTokenAccount,
  recipientReadiness,
  tokenAccountState,
} from "@sotto/sdk/confidential/public";
import { sha256Hex } from "@sotto/sdk/disclosure";
import type { SolanaRpc } from "@sotto/sdk/tx";
import { address, fetchEncodedAccounts, type Signature, type Address } from "@solana/kit";
import { and, asc, countDistinct, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { MAX_RUN_LINES } from "../payroll.ts";
import type { Readiness } from "../recipient.ts";
import type { ServerCluster } from "./cluster.ts";
import { orgWrappedMint } from "./assets.ts";
import { ApiError, apiErrors } from "./errors.ts";
import { readableGrantCondition } from "./grants.ts";
import { log } from "./log.ts";
import { requireMoneyAccess } from "./orgs.ts";
import {
  applyAttempt,
  executionSchema,
  paymentErrors,
  PROOF_PROGRAM_MAX_AGE_MS,
} from "./payments.ts";
import { recipientErrors } from "./recipients.ts";
import { recentScreening, screeningProvider, screenWallet } from "./screening.ts";
import type { Session } from "./session.ts";

const CONTROL = /\p{Cc}/u;
/** A run of 250 lines, each with a sealed blob of at most 2048 bytes, fits (08 section 3). */
export const PAYROLL_MAX_BODY_BYTES = 1_048_576;

const base64Of = (min: number, max: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, "must be base64")
    .refine((value) => {
      const bytes = Buffer.from(value, "base64");
      return bytes.length >= min && bytes.length <= max && bytes.toString("base64") === value;
    }, `must be ${min} to ${max} bytes in base64`);

export const payrollRunCreateSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => !CONTROL.test(value), "must not contain control characters"),
    /** The pay period, YYYY-MM. */
    period: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, "must be YYYY-MM"),
    idempotencyKey: z.uuid(),
    lines: z
      .array(
        z
          .object({
            recipientId: z.uuid(),
            idempotencyKey: z.uuid(),
            /** The line's amount, memo, gross and tax sealed to the owner's viewing key. */
            privateBlob: base64Of(48, 2048),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_RUN_LINES),
  })
  .strict();

/** Per line: the executions of a single payment without the integrity check (it is per chunk). */
export const lineExecutionSchema = z.discriminatedUnion("status", [
  executionSchema.options[0],
  executionSchema.options[1],
]);

export const runExecutionSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("stopped"),
      /** Why the page stopped: the step and a short code, never an amount. */
      errorCode: z.string().regex(/^[a-z0-9_:.-]{1,80}$/, "must be a short code"),
    })
    .strict(),
  /** 06 section 7: after a chunk, the sender's balance is the one the chunk's plans predicted. */
  z.object({ status: z.literal("integrity"), ok: z.boolean() }).strict(),
]);

export const payrollErrors = {
  notFound: () => new ApiError(404, "payroll_run_not_found", "Payroll run not found"),
  lineNotFound: () => new ApiError(404, "payroll_line_not_found", "Payroll line not found"),
  idempotencyConflict: () =>
    new ApiError(
      409,
      "payroll_idempotency_conflict",
      "This idempotency key belongs to another payroll run",
    ),
  duplicateRecipient: () =>
    new ApiError(422, "payroll_duplicate_recipient", "A recipient appears on more than one line"),
  status: (status: string) =>
    new ApiError(409, "payroll_run_status", `This payroll run is ${status.replaceAll("_", " ")}`),
  linesBlocked: (lines: number[]) =>
    new ApiError(
      409,
      "payroll_lines_blocked",
      lines.length === 1
        ? `Line ${lines[0]} cannot be paid now; nothing was signed`
        : `Lines ${lines.join(", ")} cannot be paid now; nothing was signed`,
    ),
  lastLine: () => new ApiError(409, "payroll_last_line", "A payroll run keeps at least one line"),
  approvalsMissing: (missing: number) =>
    new ApiError(
      409,
      "approvals_missing",
      `This payroll run needs ${missing} more ${missing === 1 ? "approval" : "approvals"}`,
    ),
};

export type PayrollLineView = {
  id: string;
  lineNo: number;
  recipientId: string;
  recipient: {
    displayName: string;
    wallet: string;
    team: string | null;
    country: string | null;
    roleTitle: string | null;
  };
  idempotencyKey: string;
  status: string;
  privateBlob: string | null;
  errorCode: string | null;
  settledSlot: string | null;
  /** Step 2.4: when the worker saw the line's transfer finalized; period grants cover by it. */
  settledAt: string | null;
  signatures: string[];
  attempts: {
    attemptNo: number;
    status: string;
    signatures: string[];
    transferSignature: string | null;
    errorCode: string | null;
  }[];
  /** The owner's own disclosure of the line exists (07 section 4). */
  disclosed: boolean;
};

export type PayrollRunView = {
  id: string;
  title: string;
  period: string;
  status: string;
  lineCount: number;
  idempotencyKey: string;
  createdAt: string;
  executedAt: string | null;
  createdBy: { userId: string; displayName: string | null; wallet: string };
  lines: PayrollLineView[];
  /**
   * Step 2.4: each readable grant that holds records of this run's lines, with how many, so
   * "Who can read this run" names the holders who can open them now.
   */
  readers: { grantId: string; holder: string; lines: number }[];
  /** D-04: the contents hash approvals sign, the policy and the initiator's execution approval. */
  contentsHash: string;
  approvals: {
    required: number;
    messages: number;
    execution: { signature: string; createdAt: string } | null;
  };
};

export type PayrollRunSummary = {
  id: string;
  title: string;
  period: string;
  status: string;
  lineCount: number;
  settled: number;
  createdAt: string;
  executedAt: string | null;
};

type RunRow = typeof payrollRuns.$inferSelect;

async function runRow(db: Database, orgId: string, runId: string): Promise<RunRow> {
  const [row] = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.id, runId), eq(payrollRuns.orgId, orgId)))
    .limit(1);
  if (!row) throw payrollErrors.notFound();
  return row;
}

async function lineRows(db: Database, runId: string) {
  return db
    .select({
      payment: payments,
      displayName: recipients.displayName,
      wallet: recipients.wallet,
      team: recipients.team,
      country: recipients.country,
      roleTitle: recipients.roleTitle,
    })
    .from(payments)
    .innerJoin(recipients, eq(recipients.id, payments.recipientId))
    .where(eq(payments.runId, runId))
    .orderBy(asc(payments.lineNo));
}

type LineRow = Awaited<ReturnType<typeof lineRows>>[number];

/** D-04: the run's lines in order, each with its recipient wallet and the hash of its blob. */
async function runContentsHash(lines: LineRow[]): Promise<string> {
  return contentsHash(
    await Promise.all(
      lines.map(async (line) => {
        if (!line.payment.privateBlob) throw new Error("a payroll line has a private blob");
        return {
          line_id: line.payment.id,
          recipient_wallet: line.wallet,
          idempotency_key: line.payment.idempotencyKey,
          private_blob_sha256: await sha256Hex(new Uint8Array(line.payment.privateBlob)),
        };
      }),
    ),
  );
}

async function requiredApprovals(db: Database, orgId: string): Promise<number> {
  const [policy] = await db
    .select({ required: orgPolicy.payrollApprovalsRequired })
    .from(orgPolicy)
    .where(eq(orgPolicy.orgId, orgId))
    .limit(1);
  return policy?.required ?? 1;
}

/** Signed approval messages over the run's current contents, by members other than the initiator. */
async function messageApprovals(db: Database, run: RunRow, expected: string): Promise<number> {
  const rows = await db
    .select({ message: approvals.message })
    .from(approvals)
    .where(
      and(
        eq(approvals.subjectType, "payroll_run"),
        eq(approvals.subjectId, run.id),
        eq(approvals.kind, "message"),
        ne(approvals.approverUserId, run.createdBy),
      ),
    );
  return rows.filter((row) => row.message === expected).length;
}

/** The approval message of a run over its lines as they are now (D-04), for POST /approvals. */
export async function currentRunApprovalMessage(
  db: Database,
  runId: string,
  cluster: ServerCluster,
): Promise<{ run: RunRow; message: string }> {
  const [run] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).limit(1);
  if (!run) throw payrollErrors.notFound();
  const hash = await runContentsHash(await lineRows(db, run.id));
  return { run, message: runApprovalMessage(run, cluster, hash) };
}

export function runApprovalMessage(
  run: Pick<RunRow, "id" | "orgId">,
  cluster: ServerCluster,
  hash: string,
): string {
  return approvalMessage({
    orgId: run.orgId,
    cluster: cluster.config.name,
    subjectType: "payroll_run",
    subjectId: run.id,
    contentsHash: hash,
  });
}

async function view(
  db: Database,
  session: Session,
  run: RunRow,
  cluster: ServerCluster | null,
): Promise<PayrollRunView> {
  const lines = await lineRows(db, run.id);
  const ids = lines.map((line) => line.payment.id);
  const [attempts, disclosed, readers, creator, execution] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([])
      : db
          .select()
          .from(paymentAttempts)
          .where(inArray(paymentAttempts.paymentId, ids))
          .orderBy(asc(paymentAttempts.attemptNo)),
    ids.length === 0
      ? Promise.resolve([])
      : db
          .selectDistinct({ subject: disclosures.subject })
          .from(disclosures)
          .where(
            and(
              eq(disclosures.orgId, run.orgId),
              eq(disclosures.kind, "payroll_line"),
              eq(disclosures.viewerUserId, session.userId),
              inArray(disclosures.subject, ids),
            ),
          ),
    ids.length === 0
      ? Promise.resolve([])
      : db
          .select({
            grantId: grants.id,
            holder: grants.holderName,
            lines: countDistinct(disclosures.subject),
          })
          .from(disclosures)
          .innerJoin(grants, eq(grants.id, disclosures.grantId))
          .where(
            and(
              eq(disclosures.orgId, run.orgId),
              eq(disclosures.kind, "payroll_line"),
              inArray(disclosures.subject, ids),
              ne(grants.scope, "own_payslips"),
              readableGrantCondition(new Date()),
            ),
          )
          .groupBy(grants.id, grants.holderName)
          .orderBy(asc(grants.holderName)),
    db
      .select({ id: users.id, displayName: users.displayName, wallet: users.wallet })
      .from(users)
      .where(eq(users.id, run.createdBy))
      .limit(1),
    db
      .select({
        signature: approvals.executionSignature,
        createdAt: approvals.createdAt,
      })
      .from(approvals)
      .where(
        and(
          eq(approvals.subjectType, "payroll_run"),
          eq(approvals.subjectId, run.id),
          eq(approvals.kind, "execution"),
          eq(approvals.approverUserId, run.createdBy),
        ),
      )
      .limit(1),
  ]);
  const hash = await runContentsHash(lines);
  const required = await requiredApprovals(db, run.orgId);
  const messages = cluster
    ? await messageApprovals(db, run, runApprovalMessage(run, cluster, hash))
    : 0;
  const opened = new Set(disclosed.map((row) => row.subject));
  const initiator = creator[0];
  const executed = execution[0];
  return {
    id: run.id,
    title: run.title,
    period: run.period,
    status: run.status,
    lineCount: run.lineCount,
    idempotencyKey: run.idempotencyKey,
    createdAt: run.createdAt.toISOString(),
    executedAt: run.executedAt?.toISOString() ?? null,
    createdBy: {
      userId: run.createdBy,
      displayName: initiator?.displayName ?? null,
      wallet: initiator?.wallet ?? "",
    },
    lines: lines.map((line) => ({
      id: line.payment.id,
      lineNo: line.payment.lineNo ?? 0,
      recipientId: line.payment.recipientId,
      recipient: {
        displayName: line.displayName,
        wallet: line.wallet,
        team: line.team,
        country: line.country,
        roleTitle: line.roleTitle,
      },
      idempotencyKey: line.payment.idempotencyKey,
      status: line.payment.status,
      privateBlob: line.payment.privateBlob
        ? Buffer.from(line.payment.privateBlob).toString("base64")
        : null,
      errorCode: line.payment.errorCode,
      settledSlot: line.payment.settledSlot?.toString() ?? null,
      settledAt: line.payment.settledAt?.toISOString() ?? null,
      signatures: line.payment.signatures,
      attempts: attempts
        .filter((attempt) => attempt.paymentId === line.payment.id)
        .map((attempt) => ({
          attemptNo: attempt.attemptNo,
          status: attempt.status,
          signatures: attempt.signatures,
          transferSignature: attempt.transferSignature,
          errorCode: attempt.errorCode,
        })),
      disclosed: opened.has(line.payment.id),
    })),
    readers: readers.map((reader) => ({
      grantId: reader.grantId,
      holder: reader.holder ?? "Holder",
      lines: reader.lines,
    })),
    contentsHash: hash,
    approvals: {
      required,
      messages,
      execution: executed?.signature
        ? { signature: executed.signature, createdAt: executed.createdAt.toISOString() }
        : null,
    },
  };
}

async function sameContents(
  db: Database,
  run: RunRow,
  input: z.infer<typeof payrollRunCreateSchema>,
): Promise<boolean> {
  if (run.title !== input.title || run.period !== input.period) return false;
  const lines = await lineRows(db, run.id);
  return (
    lines.length === input.lines.length &&
    lines.every((line, index) => {
      const given = input.lines[index];
      return (
        given !== undefined &&
        line.payment.recipientId === given.recipientId &&
        line.payment.idempotencyKey === given.idempotencyKey &&
        line.payment.privateBlob !== null &&
        Buffer.from(line.payment.privateBlob).equals(Buffer.from(given.privateBlob, "base64"))
      );
    })
  );
}

export async function createRun(
  db: Database,
  session: Session | null,
  orgId: string,
  input: z.infer<typeof payrollRunCreateSchema>,
  cluster: ServerCluster | null,
): Promise<{ run: PayrollRunView; created: boolean }> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  if (!session) throw apiErrors.unauthenticated();
  const recipientIds = input.lines.map((line) => line.recipientId);
  if (new Set(recipientIds).size !== recipientIds.length) throw payrollErrors.duplicateRecipient();
  const lineKeys = input.lines.map((line) => line.idempotencyKey);
  if (new Set([...lineKeys, input.idempotencyKey]).size !== lineKeys.length + 1) {
    throw paymentErrors.idempotencyConflict();
  }
  const found = await db
    .select({ id: recipients.id })
    .from(recipients)
    .where(and(eq(recipients.orgId, orgId), inArray(recipients.id, recipientIds)));
  if (found.length !== recipientIds.length) throw recipientErrors.notFound();

  // I-7: the same run key returns the same run; another run's key is refused.
  const [existing] = await db
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (existing) {
    if (existing.orgId !== orgId || !(await sameContents(db, existing, input))) {
      throw payrollErrors.idempotencyConflict();
    }
    return { run: await view(db, session, existing, cluster), created: false };
  }
  let runId: string;
  try {
    runId = await db.transaction(async (tx) => {
      const [run] = await tx
        .insert(payrollRuns)
        .values({
          orgId,
          title: input.title,
          period: input.period,
          idempotencyKey: input.idempotencyKey,
          lineCount: input.lines.length,
          createdBy: session.userId,
        })
        .returning({ id: payrollRuns.id });
      if (!run) throw new Error("the run was not created");
      const inserted = await tx
        .insert(payments)
        .values(
          input.lines.map((line, index) => ({
            orgId,
            kind: "payroll_line" as const,
            runId: run.id,
            lineNo: index + 1,
            recipientId: line.recipientId,
            idempotencyKey: line.idempotencyKey,
            createdBy: session.userId,
            privateBlob: Buffer.from(line.privateBlob, "base64"),
          })),
        )
        .onConflictDoNothing({ target: payments.idempotencyKey })
        .returning({ id: payments.id });
      // A line key that belongs to another payment rolls the whole run back.
      if (inserted.length !== input.lines.length) throw paymentErrors.idempotencyConflict();
      return run.id;
    });
  } catch (error) {
    // Two requests with the same run key at once: the second finds the first's run.
    const [raced] = await db
      .select()
      .from(payrollRuns)
      .where(eq(payrollRuns.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (raced && raced.orgId === orgId && (await sameContents(db, raced, input))) {
      return { run: await view(db, session, raced, cluster), created: false };
    }
    throw error;
  }
  return { run: await view(db, session, await runRow(db, orgId, runId), cluster), created: true };
}

export async function readRun(
  db: Database,
  session: Session | null,
  orgId: string,
  runId: string,
  cluster: ServerCluster | null,
): Promise<PayrollRunView> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  if (!session) throw apiErrors.unauthenticated();
  return view(db, session, await runRow(db, orgId, runId), cluster);
}

/** The org's runs, newest first, at most 100, with how many lines settled. */
export async function listRuns(
  db: Database,
  session: Session | null,
  orgId: string,
): Promise<PayrollRunSummary[]> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  const rows = await db
    .select()
    .from(payrollRuns)
    .where(eq(payrollRuns.orgId, orgId))
    .orderBy(desc(payrollRuns.createdAt))
    .limit(100);
  // The settled lines per run, grouped. A correlated subquery in the select list lost its table
  // names and compared a payment's run with its own id, so every run read 0 settled (step 3.6).
  const counts =
    rows.length === 0
      ? []
      : await db
          .select({ runId: payments.runId, settled: sql<number>`count(*)::int` })
          .from(payments)
          .where(
            and(
              inArray(
                payments.runId,
                rows.map((run) => run.id),
              ),
              eq(payments.status, "settled"),
            ),
          )
          .groupBy(payments.runId);
  const settledOf = new Map(counts.map((row) => [row.runId, Number(row.settled)]));
  return rows.map((run) => ({
    id: run.id,
    title: run.title,
    period: run.period,
    status: run.status,
    lineCount: run.lineCount,
    settled: settledOf.get(run.id) ?? 0,
    createdAt: run.createdAt.toISOString(),
    executedAt: run.executedAt?.toISOString() ?? null,
  }));
}

/** Readiness of wallets from chain (AC-07.2), in one read per 100; null when the chain is unreadable. */
async function readinessOfWallets(
  rpc: SolanaRpc,
  mint: Address | null,
  wallets: string[],
): Promise<Readiness[] | null> {
  if (!mint) return null;
  try {
    const tokens = await Promise.all(
      wallets.map((wallet) => associatedTokenAccount(address(wallet), mint)),
    );
    const result: Readiness[] = [];
    for (let i = 0; i < tokens.length; i += 100) {
      const accounts = await fetchEncodedAccounts(rpc, tokens.slice(i, i + 100), {
        commitment: "confirmed",
      });
      accounts.forEach((account, offset) =>
        result.push(
          recipientReadiness(tokenAccountState(account), {
            owner: address(wallets[i + offset] as string),
            mint,
          }),
        ),
      );
    }
    return result;
  } catch {
    return null;
  }
}

/** The transfer signatures of the lines' attempts that landed without an error, by line id. */
async function landedLines(db: Database, rpc: SolanaRpc, lineIds: string[]): Promise<Set<string>> {
  if (lineIds.length === 0) return new Set();
  const attempts = await db
    .select({
      paymentId: paymentAttempts.paymentId,
      transferSignature: paymentAttempts.transferSignature,
    })
    .from(paymentAttempts)
    .where(inArray(paymentAttempts.paymentId, lineIds));
  const sent = attempts.filter((attempt) => attempt.transferSignature !== null);
  const landed = new Set<string>();
  for (let i = 0; i < sent.length; i += 200) {
    const batch = sent.slice(i, i + 200);
    const { value } = await rpc
      .getSignatureStatuses(
        batch.map((attempt) => attempt.transferSignature as Signature),
        { searchTransactionHistory: true },
      )
      .send();
    value.forEach((status, index) => {
      const attempt = batch[index];
      if (attempt && status !== null && status.err === null) landed.add(attempt.paymentId);
    });
  }
  return landed;
}

const AUTHORIZABLE: RunRow["status"][] = [
  "draft",
  "awaiting_approval",
  "approved",
  "partially_settled",
  "failed",
];

export async function authorizeRun(
  db: Database,
  session: Session | null,
  orgId: string,
  runId: string,
  chain: { rpc: SolanaRpc; cluster: ServerCluster | null },
  now = new Date(),
): Promise<PayrollRunView> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  if (!session) throw apiErrors.unauthenticated();
  const run = await runRow(db, orgId, runId);
  if (!AUTHORIZABLE.includes(run.status)) throw payrollErrors.status(run.status);
  const cluster = chain.cluster;
  // The organization's asset (step 4.3, D-29).
  const mint = await orgWrappedMint(db, cluster, orgId);
  if (!cluster || !mint) throw paymentErrors.confidentialUnavailable();
  const lines = await lineRows(db, run.id);

  // I-7, AC-08.5: a line whose earlier transfer landed is never sent again; the job settles it.
  const unsettled = lines.filter((line) => line.payment.status !== "settled");
  const landed = await landedLines(
    db,
    chain.rpc,
    unsettled.map((line) => line.payment.id),
  );
  if (landed.size > 0) {
    await db
      .update(payments)
      .set({ status: "executing", errorCode: null, updatedAt: now })
      .where(and(inArray(payments.id, [...landed]), ne(payments.status, "settled")));
  }
  const toPay = unsettled.filter((line) => !landed.has(line.payment.id));

  // Every line still to pay, like a single payment: its account from chain now, and screening.
  const readiness = await readinessOfWallets(
    chain.rpc,
    mint,
    toPay.map((line) => line.wallet),
  );
  if (readiness === null) throw paymentErrors.readinessUnavailable();
  const blocked: { line: LineRow; code: string }[] = [];
  const provider = screeningProvider(cluster.config.name);
  for (const [index, line] of toPay.entries()) {
    const ready = readiness[index] ?? "no_account";
    await db
      .update(recipients)
      .set({ readiness: ready, readinessCheckedAt: now })
      .where(eq(recipients.id, line.payment.recipientId));
    let screening = await recentScreening(db, orgId, line.wallet, now);
    if (screening === null || screening === "error") {
      screening = await screenWallet(db, orgId, line.wallet, provider);
    }
    if (screening === "error") throw paymentErrors.screeningUnavailable();
    if (screening === "hit") {
      blocked.push({ line, code: "screening_hit" });
      log("warn", "payroll_line_blocked_by_screening", {
        orgId,
        runId: run.id,
        paymentId: line.payment.id,
      });
    } else if (ready !== "ready") {
      blocked.push({ line, code: `recipient_not_ready:${ready}` });
    }
  }
  if (blocked.length > 0) {
    await db.transaction(async (tx) => {
      for (const { line, code } of blocked) {
        await tx
          .update(payments)
          .set({ errorCode: code, updatedAt: now })
          .where(eq(payments.id, line.payment.id));
      }
    });
    throw payrollErrors.linesBlocked(blocked.map(({ line }) => line.payment.lineNo ?? 0));
  }

  // D-04: the initiator's execution is one approval; the others are signed messages.
  const hash = await runContentsHash(lines);
  const required = await requiredApprovals(db, orgId);
  const signed = await messageApprovals(db, run, runApprovalMessage(run, cluster, hash));
  const missing = required - 1 - signed;
  if (missing > 0) {
    if (run.status === "draft") {
      await db
        .update(payrollRuns)
        .set({ status: "awaiting_approval", updatedAt: now })
        .where(eq(payrollRuns.id, run.id));
    }
    throw payrollErrors.approvalsMissing(missing);
  }

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

  await db.transaction(async (tx) => {
    if (toPay.length > 0) {
      await tx
        .update(payments)
        .set({ status: "authorized", errorCode: null, updatedAt: now })
        .where(
          and(
            inArray(
              payments.id,
              toPay.map((line) => line.payment.id),
            ),
            ne(payments.status, "settled"),
          ),
        );
    }
    await tx
      .update(payrollRuns)
      .set({ status: toPay.length > 0 ? "approved" : "executing", updatedAt: now })
      .where(and(eq(payrollRuns.id, run.id), inArray(payrollRuns.status, AUTHORIZABLE)));
  });
  return view(db, session, await runRow(db, orgId, runId), cluster);
}

async function lineOf(db: Database, runId: string, lineId: string) {
  const [line] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.id, lineId), eq(payments.runId, runId)))
    .limit(1);
  if (!line) throw payrollErrors.lineNotFound();
  return line;
}

export async function recordLineExecution(
  db: Database,
  session: Session | null,
  orgId: string,
  runId: string,
  lineId: string,
  input: z.infer<typeof lineExecutionSchema>,
  cluster: ServerCluster | null,
  now = new Date(),
): Promise<PayrollRunView> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  if (!session) throw apiErrors.unauthenticated();
  const run = await runRow(db, orgId, runId);
  const line = await lineOf(db, run.id, lineId);
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: payrollRuns.status })
      .from(payrollRuns)
      .where(eq(payrollRuns.id, run.id))
      .for("update");
    const status = current?.status ?? run.status;
    if (input.status === "sent" && status !== "approved" && status !== "executing") {
      throw payrollErrors.status(status);
    }
    await applyAttempt(tx, line.id, input, now);
    if (input.status !== "sent") return;
    // AC-14.1: the run's execution starts (again, on a resume), metadata only.
    if (status === "approved") {
      await insertAccessEvent(tx, {
        orgId,
        actorUserId: session.userId,
        action: "payroll_executed",
        subjectType: "payroll_run",
        subjectId: run.id,
        metadata: { lines: run.lineCount, resumed: run.executedAt !== null },
      });
    }
    await tx
      .update(payrollRuns)
      .set({
        status: "executing",
        executedAt: sql`coalesce(${payrollRuns.executedAt}, ${now.toISOString()}::timestamptz)`,
        updatedAt: now,
      })
      .where(eq(payrollRuns.id, run.id));
    // Running the payroll is the initiator's approval, with the execution signature.
    await tx
      .insert(approvals)
      .values({
        orgId,
        subjectType: "payroll_run",
        subjectId: run.id,
        approverUserId: session.userId,
        kind: "execution",
        executionSignature: input.signature,
      })
      .onConflictDoNothing({
        target: [approvals.subjectType, approvals.subjectId, approvals.approverUserId],
      });
  });
  return view(db, session, await runRow(db, orgId, runId), cluster);
}

export async function recordRunExecution(
  db: Database,
  session: Session | null,
  orgId: string,
  runId: string,
  input: z.infer<typeof runExecutionSchema>,
  cluster: ServerCluster | null,
  now = new Date(),
): Promise<PayrollRunView> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  if (!session) throw apiErrors.unauthenticated();
  const run = await runRow(db, orgId, runId);
  if (input.status === "integrity") {
    log(
      input.ok ? "info" : "error",
      input.ok ? "payroll_integrity_ok" : "payroll_integrity_alert",
      {
        orgId,
        runId,
      },
    );
    return view(db, session, run, cluster);
  }
  // The page stopped before every line landed: partially settled if a line landed or is landing.
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: payrollRuns.status })
      .from(payrollRuns)
      .where(eq(payrollRuns.id, run.id))
      .for("update");
    const status = current?.status ?? run.status;
    if (status !== "executing" && status !== "approved") throw payrollErrors.status(status);
    const [counts] = await tx
      .select({
        landing: sql<number>`count(*) filter (where ${payments.status} in ('settled', 'executing'))::int`,
        open: sql<number>`count(*) filter (where ${payments.status} <> 'settled')::int`,
      })
      .from(payments)
      .where(eq(payments.runId, run.id));
    const next =
      Number(counts?.open ?? 0) === 0
        ? "settled"
        : Number(counts?.landing ?? 0) > 0
          ? "partially_settled"
          : "failed";
    await tx
      .update(payrollRuns)
      .set({ status: next, updatedAt: now })
      .where(eq(payrollRuns.id, run.id));
    await insertAccessEvent(tx, {
      orgId,
      actorUserId: session.userId,
      action: "payroll_run_stopped",
      subjectType: "payroll_run",
      subjectId: run.id,
      metadata: { status: next, errorCode: input.errorCode },
    });
  });
  log("info", "payroll_run_stopped", { orgId, runId, errorCode: input.errorCode });
  return view(db, session, await runRow(db, orgId, runId), cluster);
}

/** Removes a line from a run that never started, for example a blocked line (step 2.3). */
export async function removeLine(
  db: Database,
  session: Session | null,
  orgId: string,
  runId: string,
  lineId: string,
  cluster: ServerCluster | null,
): Promise<PayrollRunView> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  if (!session) throw apiErrors.unauthenticated();
  const run = await runRow(db, orgId, runId);
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: payrollRuns.status, lineCount: payrollRuns.lineCount })
      .from(payrollRuns)
      .where(eq(payrollRuns.id, run.id))
      .for("update");
    if (!current || !["draft", "awaiting_approval"].includes(current.status)) {
      throw payrollErrors.status(current?.status ?? run.status);
    }
    const line = await lineOf(db, run.id, lineId);
    const [attempt] = await tx
      .select({ id: paymentAttempts.id })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.paymentId, line.id))
      .limit(1);
    if (attempt) throw paymentErrors.status(line.status);
    if (current.lineCount <= 1) throw payrollErrors.lastLine();
    await tx.delete(payments).where(eq(payments.id, line.id));
    await tx
      .update(payrollRuns)
      .set({ lineCount: current.lineCount - 1, updatedAt: new Date() })
      .where(eq(payrollRuns.id, run.id));
  });
  return view(db, session, await runRow(db, orgId, runId), cluster);
}
