// Single payments (F-06, 08 section 3; step 1.9) against a test database and a chain stand in: drafts
// with idempotency keys (AC-06.1, I-7), screening that blocks a deny-listed wallet and logs it
// (AC-06.2), the approval policy with the initiator's execution and signed approval messages over the
// contents hash (AC-06.3, D-04), the recipient read from chain right before the
// payment, the proof program flag (F-19), the executions record and a retry that never resends a
// transfer that landed, and the money gate of AC-02.2.
import { randomUUID } from "node:crypto";
import {
  approvals,
  clusterHealth,
  memberships,
  orgPolicy,
  payments,
  recipients,
  screenings,
} from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { approvalMessage, contentsHash } from "@sotto/sdk/approvals";
import { getClusterConfig } from "@sotto/sdk/cluster";
import { associatedTokenAccount } from "@sotto/sdk/confidential/public";
import { sha256Hex } from "@sotto/sdk/disclosure";
import { confidentialTokenAccount, encodeToken2022Account } from "@sotto/sdk/testing";
import {
  address,
  getAddressDecoder,
  getBase58Decoder,
  getBase64Decoder,
  type Address,
} from "@solana/kit";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createKeyUser,
  createOrgWithStatus,
  errorOf,
  jsonRequest,
  setUpApiTest,
  tearDownApiTest,
} from "./helpers/api.ts";

const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const devnet = getClusterConfig("devnet");
const WUSDC = (devnet.available ? devnet.wrappedUsdcMint : null) as Address;
const ELGAMAL = address("BxMVLbjVntF9DJtDjfpQLrgw4hopedMgNkZZKGcVkZp6");
const DENIED = "3is1rfSs3j8ethSn2WVnZAPufEuUFMEe3ay8hgRoQWqK";

const chain = new Map<string, Uint8Array>();
/** Signature statuses the stand in reports; a missing entry is "not found". */
const landed = new Map<string, { err: unknown }>();
let chainDown = false;

vi.mock("../lib/server/chain.ts", () => ({
  serverRpc: () => ({
    getAccountInfo: (target: string) => ({
      send: async () => {
        if (chainDown) throw new Error("the network is down");
        const data = chain.get(target);
        return {
          context: { slot: 7n },
          value: data
            ? {
                data: [getBase64Decoder().decode(data), "base64"],
                executable: false,
                lamports: 2_039_280n,
                owner: TOKEN_2022,
                space: BigInt(data.length),
                rentEpoch: 0n,
              }
            : null,
        };
      },
    }),
    getSignatureStatuses: (signatures: string[]) => ({
      send: async () => ({
        context: { slot: 9n },
        value: signatures.map((signature) => {
          const status = landed.get(signature);
          return status
            ? {
                slot: 8n,
                confirmations: null,
                err: status.err,
                confirmationStatus: "finalized",
              }
            : null;
        }),
      }),
    }),
  }),
}));

const list = await import("../app/api/orgs/[id]/payments/route.ts");
const one = await import("../app/api/orgs/[id]/payments/[pid]/route.ts");
const authorize = await import("../app/api/orgs/[id]/payments/[pid]/authorize/route.ts");
const executions = await import("../app/api/orgs/[id]/payments/[pid]/executions/route.ts");
const screen = await import("../app/api/orgs/[id]/screen/route.ts");
const approve = await import("../app/api/approvals/route.ts");

let test: TestDatabase;
let lines: string[] = [];

beforeAll(async () => {
  test = await setUpApiTest();
});

afterAll(async () => {
  await tearDownApiTest(test);
});

beforeEach(() => {
  lines = [];
  vi.spyOn(console, "log").mockImplementation((line: unknown) => void lines.push(String(line)));
  vi.spyOn(console, "error").mockImplementation((line: unknown) => void lines.push(String(line)));
  vi.stubEnv("NEXT_PUBLIC_CLUSTER", "devnet");
  chainDown = false;
});

const randomAddress = () => getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));
const randomSignature = () => getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(64)));
const blob = (fill = 5) => Buffer.alloc(96, fill).toString("base64");

/** A wallet whose wUSDC account can receive confidential transfers onchain. */
async function readyWallet(wallet: string = randomAddress()): Promise<string> {
  chain.set(
    await associatedTokenAccount(address(wallet), WUSDC),
    encodeToken2022Account(
      confidentialTokenAccount({ owner: address(wallet), mint: WUSDC, elgamalPubkey: ELGAMAL }),
    ),
  );
  return wallet;
}

async function proofProgram(ok: boolean, minutesAgo = 1) {
  const values = {
    proofProgramOk: ok,
    detail: null,
    checkedAt: new Date(Date.now() - minutesAgo * 60_000),
  };
  await test.db
    .insert(clusterHealth)
    .values({ cluster: "devnet", ...values })
    .onConflictDoUpdate({ target: clusterHealth.cluster, set: values });
}

/** An active org with its owner and one recipient whose account is ready. */
async function setUp(wallet?: string) {
  const owner = await createKeyUser(test);
  const orgId = await createOrgWithStatus(test, owner.userId, "active");
  await test.db.insert(orgPolicy).values({ orgId }).onConflictDoNothing();
  const [recipient] = await test.db
    .insert(recipients)
    .values({ orgId, displayName: "Maya Chen", wallet: await readyWallet(wallet) })
    .returning();
  if (!recipient) throw new Error("recipient not created");
  await proofProgram(true);
  return { owner, orgId, recipient };
}

const params = (id: string, pid?: string) => ({
  params: Promise.resolve(pid ? { id, pid } : { id }),
});
const create = (cookie: string | null, orgId: string, body: unknown) =>
  list.POST(jsonRequest(`/api/orgs/${orgId}/payments`, "POST", cookie, body), params(orgId));
const authorizeAs = (cookie: string | null, orgId: string, pid: string) =>
  authorize.POST(
    jsonRequest(`/api/orgs/${orgId}/payments/${pid}/authorize`, "POST", cookie),
    params(orgId, pid),
  );
const execute = (cookie: string | null, orgId: string, pid: string, body: unknown) =>
  executions.POST(
    jsonRequest(`/api/orgs/${orgId}/payments/${pid}/executions`, "POST", cookie, body),
    params(orgId, pid),
  );

type View = {
  id: string;
  status: string;
  contentsHash: string;
  approvals: { required: number; messages: number };
  attempts: { attemptNo: number; status: string; transferSignature: string | null }[];
};

async function draft(cookie: string, orgId: string, recipientId: string, fill = 5) {
  const response = await create(cookie, orgId, {
    recipientId,
    idempotencyKey: randomUUID(),
    privateBlob: blob(fill),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { payment: View }).payment;
}

describe("payments", () => {
  it("AC-06.1 creates a draft for a recipient with the amount sealed, and the same idempotency key returns the same draft", async () => {
    const { owner, orgId, recipient } = await setUp();
    const idempotencyKey = randomUUID();
    const body = { recipientId: recipient.id, idempotencyKey, privateBlob: blob() };
    const first = await create(owner.cookie, orgId, body);
    expect(first.status).toBe(201);
    const { payment } = (await first.json()) as { payment: View & Record<string, unknown> };
    expect(payment).toMatchObject({
      status: "draft",
      recipient: { displayName: "Maya Chen", wallet: recipient.wallet },
      privateBlob: blob(),
      approvals: { required: 1, messages: 0 },
    });
    // D-04: one line, the payment itself, hashed over its sealed blob.
    expect(payment.contentsHash).toBe(
      await contentsHash([
        {
          line_id: payment.id,
          recipient_wallet: recipient.wallet,
          idempotency_key: idempotencyKey,
          private_blob_sha256: await sha256Hex(Buffer.from(blob(), "base64")),
        },
      ]),
    );
    const again = await create(owner.cookie, orgId, body);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { payment: View }).payment.id).toBe(payment.id);
    // The same key for other contents is refused, and nothing is stored twice.
    expect(
      await errorOf(await create(owner.cookie, orgId, { ...body, privateBlob: blob(6) })),
    ).toMatchObject({ code: "payment_idempotency_conflict" });
    const other = await setUp();
    expect(
      await errorOf(
        await create(owner.cookie, orgId, {
          recipientId: other.recipient.id,
          idempotencyKey: randomUUID(),
          privateBlob: blob(),
        }),
      ),
    ).toMatchObject({ code: "recipient_not_found" });
    const rows = await test.db.select().from(payments).where(eq(payments.orgId, orgId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.createdBy).toBe(owner.userId);
  });

  it("AC-06.2 screens the recipient before authorization: a hit blocks the payment and logs the event", async () => {
    const { owner, orgId, recipient } = await setUp(DENIED);
    const payment = await draft(owner.cookie, orgId, recipient.id);
    const blocked = await authorizeAs(owner.cookie, orgId, payment.id);
    expect(blocked.status).toBe(422);
    expect(await errorOf(blocked)).toEqual({
      code: "screening_hit",
      message: "The recipient's wallet is on the screening list, so the payment is blocked",
    });
    const stored = await test.db.select().from(screenings).where(eq(screenings.orgId, orgId));
    expect(stored).toMatchObject([{ wallet: DENIED, provider: "denylist", result: "hit" }]);
    expect(lines.some((line) => line.includes('"event":"screening_hit"'))).toBe(true);
    expect(lines.some((line) => line.includes('"event":"payment_blocked_by_screening"'))).toBe(
      true,
    );
    const [row] = await test.db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row).toMatchObject({ status: "draft", errorCode: "screening_hit" });

    // The screen endpoint gives the same verdicts, and a clear wallet is authorized.
    const clear = randomAddress();
    const screened = await screen.POST(
      jsonRequest(`/api/orgs/${orgId}/screen`, "POST", owner.cookie, { wallets: [DENIED, clear] }),
      params(orgId),
    );
    expect(await screened.json()).toEqual({
      provider: "denylist",
      results: [
        { wallet: DENIED, result: "hit" },
        { wallet: clear, result: "clear" },
      ],
    });
    const ok = await setUp();
    const fine = await draft(ok.owner.cookie, ok.orgId, ok.recipient.id);
    const authorized = await authorizeAs(ok.owner.cookie, ok.orgId, fine.id);
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toMatchObject({
      authorized: true,
      payment: { status: "authorized" },
    });
  });

  it("reads the recipient's account from chain right before authorizing, and refuses with the reason", async () => {
    const { owner, orgId, recipient } = await setUp();
    const payment = await draft(owner.cookie, orgId, recipient.id);
    chain.delete(await associatedTokenAccount(address(recipient.wallet), WUSDC));
    const refused = await authorizeAs(owner.cookie, orgId, payment.id);
    expect(refused.status).toBe(409);
    expect(await errorOf(refused)).toEqual({
      code: "recipient_not_ready",
      message:
        "Cannot be paid confidentially yet: there is no wUSDC account at this wallet. Their invite link walks them through setting one up.",
    });
    const [stored] = await test.db
      .select({ readiness: recipients.readiness })
      .from(recipients)
      .where(eq(recipients.id, recipient.id));
    expect(stored?.readiness).toBe("no_account");
    chainDown = true;
    expect(await errorOf(await authorizeAs(owner.cookie, orgId, payment.id))).toMatchObject({
      code: "readiness_unavailable",
    });
  });

  it("AC-06.3 counts the initiator's execution as the default approval, and with a policy of 2 needs another member's signed message over the current contents", async () => {
    const { owner, orgId, recipient } = await setUp();
    // Policies above 1 cannot be set through the API in this build; set it directly.
    await test.db
      .update(orgPolicy)
      .set({ paymentApprovalsRequired: 2 })
      .where(eq(orgPolicy.orgId, orgId));
    const payment = await draft(owner.cookie, orgId, recipient.id);
    expect(payment.approvals).toEqual({ required: 2, messages: 0 });
    expect(await errorOf(await authorizeAs(owner.cookie, orgId, payment.id))).toEqual({
      code: "approvals_missing",
      message: "This payment needs 1 more approval",
    });

    const approver = await createKeyUser(test);
    await test.db.insert(memberships).values({ orgId, userId: approver.userId, role: "approver" });
    const message = approvalMessage({
      orgId,
      cluster: "devnet",
      subjectType: "payment",
      subjectId: payment.id,
      contentsHash: payment.contentsHash,
    });
    const sign = async (who: typeof approver, text: string) =>
      Buffer.from(await who.sign(new TextEncoder().encode(text))).toString("base64");
    const post = (cookie: string, body: unknown) =>
      approve.POST(jsonRequest("/api/approvals", "POST", cookie, body));
    const body = async (who: typeof approver, text = message) => ({
      subjectType: "payment",
      subjectId: payment.id,
      message: text,
      signature: await sign(who, text),
    });
    // The initiator's own message does not count: their execution is their approval.
    expect(await errorOf(await post(owner.cookie, await body(owner)))).toMatchObject({
      code: "approval_by_initiator",
    });
    // A message over other contents, and a signature by another wallet, are refused.
    const stale = message.replace(payment.contentsHash, "0".repeat(64));
    expect(await errorOf(await post(approver.cookie, await body(approver, stale)))).toMatchObject({
      code: "approval_message_mismatch",
    });
    const stranger = await createKeyUser(test);
    expect(
      await errorOf(
        await post(approver.cookie, {
          ...(await body(approver)),
          signature: await sign(stranger, message),
        }),
      ),
    ).toMatchObject({ code: "approval_signature_invalid" });
    // A non member cannot approve.
    expect((await post(stranger.cookie, await body(stranger))).status).toBe(403);

    expect((await post(approver.cookie, await body(approver))).status).toBe(201);
    expect(message.split("\n")).toEqual([
      "sotto-approval/v1",
      "I approve this in Sotto. Signing sends no transaction and costs no fee.",
      `Organization: ${orgId}`,
      "Cluster: devnet",
      `Subject: payment ${payment.id}`,
      `Contents: ${payment.contentsHash}`,
    ]);
    const authorized = await authorizeAs(owner.cookie, orgId, payment.id);
    expect(authorized.status).toBe(200);
    expect(((await authorized.json()) as { payment: View }).payment.approvals).toEqual({
      required: 2,
      messages: 1,
    });

    // D-04: a change to the contents invalidates the approval.
    await test.db
      .update(payments)
      .set({ privateBlob: Buffer.from(blob(9), "base64") })
      .where(eq(payments.id, payment.id));
    expect(await errorOf(await authorizeAs(owner.cookie, orgId, payment.id))).toMatchObject({
      code: "approvals_missing",
    });
  });

  it("F-19 authorizes only after a recent successful proof program check", async () => {
    const { owner, orgId, recipient } = await setUp();
    const payment = await draft(owner.cookie, orgId, recipient.id);
    await proofProgram(false);
    expect(await errorOf(await authorizeAs(owner.cookie, orgId, payment.id))).toMatchObject({
      code: "proof_program_unavailable",
    });
    await proofProgram(true, 20);
    expect(await errorOf(await authorizeAs(owner.cookie, orgId, payment.id))).toMatchObject({
      code: "proof_program_unavailable",
    });
    await proofProgram(true);
    expect((await authorizeAs(owner.cookie, orgId, payment.id)).status).toBe(200);
  });

  it("records each signature before sending with the initiator's approval, ends a failed attempt, and never resends a transfer that landed (I-7)", async () => {
    const { owner, orgId, recipient } = await setUp();
    const payment = await draft(owner.cookie, orgId, recipient.id);
    // Nothing is recorded before authorization.
    const early = randomSignature();
    expect(
      await errorOf(
        await execute(owner.cookie, orgId, payment.id, {
          status: "sent",
          attemptNo: 1,
          signature: early,
          transfer: false,
        }),
      ),
    ).toMatchObject({ code: "payment_status" });
    expect((await authorizeAs(owner.cookie, orgId, payment.id)).status).toBe(200);

    const proof = randomSignature();
    const transfer = randomSignature();
    const first = await execute(owner.cookie, orgId, payment.id, {
      status: "sent",
      attemptNo: 1,
      signature: proof,
      transfer: false,
    });
    expect(((await first.json()) as { payment: View }).payment.status).toBe("executing");
    const second = await execute(owner.cookie, orgId, payment.id, {
      status: "sent",
      attemptNo: 1,
      signature: transfer,
      transfer: true,
    });
    expect(((await second.json()) as { payment: View }).payment.attempts).toMatchObject([
      { attemptNo: 1, status: "sent", transferSignature: transfer },
    ]);
    // The initiator's approval, with the first execution signature.
    const recorded = await test.db
      .select()
      .from(approvals)
      .where(and(eq(approvals.subjectId, payment.id), eq(approvals.kind, "execution")));
    expect(recorded).toMatchObject([{ approverUserId: owner.userId, executionSignature: proof }]);

    const ended = await execute(owner.cookie, orgId, payment.id, {
      status: "failed_clean",
      attemptNo: 1,
      errorCode: "transfer:simulation_failed",
      signatures: [randomSignature()],
    });
    expect(((await ended.json()) as { payment: View }).payment.status).toBe("failed_clean");

    // The transfer landed after all: authorize refuses and the payment waits for the job.
    landed.set(transfer, { err: null });
    expect(await errorOf(await authorizeAs(owner.cookie, orgId, payment.id))).toMatchObject({
      code: "payment_transfer_landed",
    });
    const [row] = await test.db.select().from(payments).where(eq(payments.id, payment.id));
    expect(row?.status).toBe("executing");
  });

  it("allows a safe retry as the next attempt when the earlier transfer did not land", async () => {
    const { owner, orgId, recipient } = await setUp();
    const payment = await draft(owner.cookie, orgId, recipient.id);
    await authorizeAs(owner.cookie, orgId, payment.id);
    const transfer = randomSignature();
    await execute(owner.cookie, orgId, payment.id, {
      status: "sent",
      attemptNo: 1,
      signature: transfer,
      transfer: true,
    });
    landed.set(transfer, { err: { InstructionError: [0, "InvalidAccountData"] } });
    await execute(owner.cookie, orgId, payment.id, {
      status: "failed_clean",
      attemptNo: 1,
      errorCode: "transfer:onchain",
      signatures: [],
    });
    expect((await authorizeAs(owner.cookie, orgId, payment.id)).status).toBe(200);
    // Attempt 3 would skip a number; attempt 2 is the retry.
    const skip = await execute(owner.cookie, orgId, payment.id, {
      status: "sent",
      attemptNo: 3,
      signature: randomSignature(),
      transfer: false,
    });
    expect(await errorOf(skip)).toMatchObject({ code: "payment_status" });
    const retry = await execute(owner.cookie, orgId, payment.id, {
      status: "sent",
      attemptNo: 2,
      signature: randomSignature(),
      transfer: false,
    });
    expect(
      ((await retry.json()) as { payment: View }).payment.attempts.map((a) => a.attemptNo),
    ).toEqual([1, 2]);
    // The integrity check result is logged, never an amount.
    await execute(owner.cookie, orgId, payment.id, { status: "integrity", ok: false });
    expect(lines.some((line) => line.includes('"event":"payment_integrity_alert"'))).toBe(true);
  });

  it("AC-02.2 lets only the owner of an active org use the payment endpoints", async () => {
    const { owner, orgId, recipient } = await setUp();
    const payment = await draft(owner.cookie, orgId, recipient.id);
    const accountant = await createKeyUser(test);
    await test.db
      .insert(memberships)
      .values({ orgId, userId: accountant.userId, role: "accountant" });
    const stranger = await createKeyUser(test);
    for (const user of [accountant, stranger]) {
      expect(
        (
          await create(user.cookie, orgId, {
            recipientId: recipient.id,
            idempotencyKey: randomUUID(),
            privateBlob: blob(),
          })
        ).status,
      ).toBe(403);
      expect((await authorizeAs(user.cookie, orgId, payment.id)).status).toBe(403);
      expect(
        (
          await one.GET(
            jsonRequest(`/api/orgs/${orgId}/payments/${payment.id}`, "GET", user.cookie),
            params(orgId, payment.id),
          )
        ).status,
      ).toBe(403);
    }
    expect((await authorizeAs(null, orgId, payment.id)).status).toBe(401);
    for (const status of ["pending_review", "suspended"] as const) {
      const other = await createKeyUser(test);
      const otherOrg = await createOrgWithStatus(test, other.userId, status);
      expect(
        await errorOf(
          await create(other.cookie, otherOrg, {
            recipientId: randomUUID(),
            idempotencyKey: randomUUID(),
            privateBlob: blob(),
          }),
        ),
      ).toMatchObject({ code: "org_not_active" });
    }
    const read = await list.GET(
      jsonRequest(`/api/orgs/${orgId}/payments`, "GET", owner.cookie),
      params(orgId),
    );
    expect(((await read.json()) as { payments: View[] }).payments.map((p) => p.id)).toEqual([
      payment.id,
    ]);
  });
});
