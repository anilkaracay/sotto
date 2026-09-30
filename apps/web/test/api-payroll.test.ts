// Payroll runs (F-08, 08 section 3; step 2.3) against a test database and a chain stand in: a draft
// run of the org's recipients with each line sealed and an idempotency key per run and per line
// (AC-08.1, I-7); lines not ready or deny listed blocked before anything is signed, with each line's
// reason (AC-08.2, AC-07.4, D-10); each line's signatures recorded before sending, the run executing
// with the initiator's approval and stopped as partially settled (AC-08.2, AC-08.4, Q-11, 13 A31); a
// resume that reads the chain first, so a line whose transfer landed is never authorized again
// (AC-08.5); a policy of 2 through signed approval messages over the run's contents (D-04, Q-12 (a));
// and the money gate.
import { randomUUID } from "node:crypto";
import { clusterHealth, memberships, orgPolicy, payments, recipients } from "@sotto/db";
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
import { eq } from "drizzle-orm";
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

const encoded = (data: Uint8Array | undefined) =>
  data
    ? {
        data: [getBase64Decoder().decode(data), "base64"],
        executable: false,
        lamports: 2_039_280n,
        owner: TOKEN_2022,
        space: BigInt(data.length),
        rentEpoch: 0n,
      }
    : null;

vi.mock("../lib/server/chain.ts", () => ({
  serverRpc: () => ({
    getAccountInfo: (target: string) => ({
      send: async () => ({ context: { slot: 7n }, value: encoded(chain.get(target)) }),
    }),
    getMultipleAccounts: (targets: string[]) => ({
      send: async () => ({
        context: { slot: 7n },
        value: targets.map((target) => encoded(chain.get(target))),
      }),
    }),
    getSignatureStatuses: (signatures: string[]) => ({
      send: async () => ({
        context: { slot: 9n },
        value: signatures.map((signature) => {
          const status = landed.get(signature);
          return status
            ? { slot: 8n, confirmations: null, err: status.err, confirmationStatus: "confirmed" }
            : null;
        }),
      }),
    }),
  }),
}));

const runs = await import("../app/api/orgs/[id]/payroll-runs/route.ts");
const one = await import("../app/api/orgs/[id]/payroll-runs/[rid]/route.ts");
const authorize = await import("../app/api/orgs/[id]/payroll-runs/[rid]/authorize/route.ts");
const runExecutions = await import("../app/api/orgs/[id]/payroll-runs/[rid]/executions/route.ts");
const lineExecutions =
  await import("../app/api/orgs/[id]/payroll-runs/[rid]/lines/[lid]/executions/route.ts");
const line = await import("../app/api/orgs/[id]/payroll-runs/[rid]/lines/[lid]/route.ts");
const approve = await import("../app/api/approvals/route.ts");

let test: TestDatabase;
let logs: string[] = [];

beforeAll(async () => {
  test = await setUpApiTest();
});

afterAll(async () => {
  await tearDownApiTest(test);
});

beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((entry: unknown) => void logs.push(String(entry)));
  vi.spyOn(console, "error").mockImplementation((entry: unknown) => void logs.push(String(entry)));
  vi.stubEnv("NEXT_PUBLIC_CLUSTER", "devnet");
});

const randomAddress = () => getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));
const randomSignature = () => getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(64)));
const blob = (fill = 5) => Buffer.alloc(96, fill).toString("base64");

async function readyWallet(wallet: string = randomAddress()): Promise<string> {
  chain.set(
    await associatedTokenAccount(address(wallet), WUSDC),
    encodeToken2022Account(
      confidentialTokenAccount({ owner: address(wallet), mint: WUSDC, elgamalPubkey: ELGAMAL }),
    ),
  );
  return wallet;
}

async function proofProgram(ok: boolean) {
  const values = { proofProgramOk: ok, detail: null, checkedAt: new Date(Date.now() - 60_000) };
  await test.db
    .insert(clusterHealth)
    .values({ cluster: "devnet", ...values })
    .onConflictDoUpdate({ target: clusterHealth.cluster, set: values });
}

/** An active org with its owner and recipients whose wallets are given (ready unless noted). */
async function setUp(wallets: string[]) {
  const owner = await createKeyUser(test);
  const orgId = await createOrgWithStatus(test, owner.userId, "active");
  await test.db.insert(orgPolicy).values({ orgId }).onConflictDoNothing();
  const people = [];
  for (const [index, wallet] of wallets.entries()) {
    const [row] = await test.db
      .insert(recipients)
      .values({ orgId, displayName: `Person ${index + 1}`, team: "Engineering", wallet })
      .returning();
    if (!row) throw new Error("recipient not created");
    people.push(row);
  }
  await proofProgram(true);
  return { owner, orgId, people };
}

type RouteParams = Record<string, string>;
const params = (values: RouteParams) => ({ params: Promise.resolve(values) });

type LineView = {
  id: string;
  lineNo: number;
  status: string;
  errorCode: string | null;
  idempotencyKey: string;
  privateBlob: string;
  recipient: { wallet: string };
  attempts: { attemptNo: number; status: string; transferSignature: string | null }[];
};
type RunView = {
  id: string;
  status: string;
  lineCount: number;
  executedAt: string | null;
  contentsHash: string;
  lines: LineView[];
  approvals: { required: number; messages: number; execution: { signature: string } | null };
};

const body = (people: { id: string }[], key = randomUUID(), fills?: number[]) => ({
  title: "October payroll",
  period: "2026-10",
  idempotencyKey: key,
  lines: people.map((person, index) => ({
    recipientId: person.id,
    idempotencyKey: randomUUID(),
    privateBlob: blob(fills?.[index] ?? index + 1),
  })),
});

const create = (cookie: string | null, orgId: string, input: unknown) =>
  runs.POST(
    jsonRequest(`/api/orgs/${orgId}/payroll-runs`, "POST", cookie, input),
    params({ id: orgId }),
  );
const read = async (cookie: string, orgId: string, rid: string) =>
  (
    (await (
      await one.GET(
        jsonRequest(`/api/orgs/${orgId}/payroll-runs/${rid}`, "GET", cookie),
        params({ id: orgId, rid }),
      )
    ).json()) as { run: RunView }
  ).run;
const authorizeAs = (cookie: string, orgId: string, rid: string) =>
  authorize.POST(
    jsonRequest(`/api/orgs/${orgId}/payroll-runs/${rid}/authorize`, "POST", cookie),
    params({ id: orgId, rid }),
  );
const executeLine = (cookie: string, orgId: string, rid: string, lid: string, input: unknown) =>
  lineExecutions.POST(
    jsonRequest(
      `/api/orgs/${orgId}/payroll-runs/${rid}/lines/${lid}/executions`,
      "POST",
      cookie,
      input,
    ),
    params({ id: orgId, rid, lid }),
  );
const executeRun = (cookie: string, orgId: string, rid: string, input: unknown) =>
  runExecutions.POST(
    jsonRequest(`/api/orgs/${orgId}/payroll-runs/${rid}/executions`, "POST", cookie, input),
    params({ id: orgId, rid }),
  );
const remove = (cookie: string, orgId: string, rid: string, lid: string) =>
  line.DELETE(
    jsonRequest(`/api/orgs/${orgId}/payroll-runs/${rid}/lines/${lid}`, "DELETE", cookie),
    params({ id: orgId, rid, lid }),
  );

async function draftRun(cookie: string, orgId: string, people: { id: string }[]) {
  const response = await create(cookie, orgId, body(people));
  expect(response.status).toBe(201);
  return ((await response.json()) as { run: RunView }).run;
}

describe("payroll runs", () => {
  it("AC-08.1 AC-08.2 creates a draft run of the org's recipients with each line sealed, and the same run key returns the same run", async () => {
    const { owner, orgId, people } = await setUp([
      await readyWallet(),
      await readyWallet(),
      await readyWallet(),
    ]);
    const input = body(people);
    const first = await create(owner.cookie, orgId, input);
    expect(first.status).toBe(201);
    const { run } = (await first.json()) as { run: RunView };
    expect(run).toMatchObject({
      status: "draft",
      lineCount: 3,
      executedAt: null,
      approvals: { required: 1, messages: 0, execution: null },
    });
    expect(run.lines.map((item) => item.lineNo)).toEqual([1, 2, 3]);
    expect(run.lines.map((item) => item.status)).toEqual(["draft", "draft", "draft"]);
    expect(run.lines.map((item) => item.privateBlob)).toEqual([blob(1), blob(2), blob(3)]);
    // D-04: the lines in order, each hashed over its own sealed blob.
    expect(run.contentsHash).toBe(
      await contentsHash(
        await Promise.all(
          run.lines.map(async (item, index) => ({
            line_id: item.id,
            recipient_wallet: people[index]?.wallet ?? "",
            idempotency_key: input.lines[index]?.idempotencyKey ?? "",
            private_blob_sha256: await sha256Hex(Buffer.from(blob(index + 1), "base64")),
          })),
        ),
      ),
    );
    const again = await create(owner.cookie, orgId, input);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { run: RunView }).run.id).toBe(run.id);
    expect(
      await errorOf(
        await create(owner.cookie, orgId, {
          ...input,
          lines: input.lines.map((item, index) =>
            index === 0 ? { ...item, privateBlob: blob(9) } : item,
          ),
        }),
      ),
    ).toMatchObject({ code: "payroll_idempotency_conflict" });
    // One line per recipient, recipients of this org only.
    const person = people[0] as { id: string };
    expect(await errorOf(await create(owner.cookie, orgId, body([person, person])))).toMatchObject({
      code: "payroll_duplicate_recipient",
    });
    const other = await setUp([await readyWallet()]);
    expect(
      await errorOf(await create(owner.cookie, orgId, body([person, ...other.people]))),
    ).toMatchObject({ code: "recipient_not_found" });
    // A line key that belongs to another payment rolls the whole run back.
    const reused = body(people.slice(1));
    const taken = input.lines[0]?.idempotencyKey ?? "";
    const clash = { ...reused, lines: [{ ...reused.lines[0], idempotencyKey: taken }] };
    expect(await errorOf(await create(owner.cookie, orgId, clash))).toMatchObject({
      code: "payment_idempotency_conflict",
    });
    const stored = await test.db.select().from(payments).where(eq(payments.orgId, orgId));
    expect(stored).toHaveLength(3);
    expect(stored.every((row) => row.kind === "payroll_line" && row.runId === run.id)).toBe(true);
    const listed = await runs.GET(
      jsonRequest(`/api/orgs/${orgId}/payroll-runs`, "GET", owner.cookie),
      params({ id: orgId }),
    );
    expect(((await listed.json()) as { runs: unknown[] }).runs).toMatchObject([
      { id: run.id, status: "draft", lineCount: 3, settled: 0, title: "October payroll" },
    ]);
  });

  it("AC-08.2 blocks before signing a run where one recipient is not ready and one is deny listed, with each line's reason, and authorizes the rest once they are removed", async () => {
    const { owner, orgId, people } = await setUp([
      await readyWallet(),
      randomAddress(),
      await readyWallet(DENIED),
      await readyWallet(),
    ]);
    const run = await draftRun(owner.cookie, orgId, people);
    const blocked = await authorizeAs(owner.cookie, orgId, run.id);
    expect(blocked.status).toBe(409);
    expect(await errorOf(blocked)).toEqual({
      code: "payroll_lines_blocked",
      message: "Lines 2, 3 cannot be paid now; nothing was signed",
    });
    const after = await read(owner.cookie, orgId, run.id);
    expect(after.status).toBe("draft");
    expect(after.lines.map((item) => [item.status, item.errorCode])).toEqual([
      ["draft", null],
      ["draft", "recipient_not_ready:no_account"],
      ["draft", "screening_hit"],
      ["draft", null],
    ]);
    expect(
      logs.some((entry) => entry.includes('"event":"payroll_line_blocked_by_screening"')),
    ).toBe(true);
    // The blocked lines leave the run; the rest is authorized.
    for (const item of after.lines.slice(1, 3)) {
      expect((await remove(owner.cookie, orgId, run.id, item.id)).status).toBe(200);
    }
    const authorized = await authorizeAs(owner.cookie, orgId, run.id);
    expect(authorized.status).toBe(200);
    const { run: approved } = (await authorized.json()) as { run: RunView };
    expect(approved).toMatchObject({ status: "approved", lineCount: 2 });
    expect(approved.lines.map((item) => [item.lineNo, item.status])).toEqual([
      [1, "authorized"],
      [4, "authorized"],
    ]);
    // A run that started keeps its lines, and a run keeps at least one.
    expect(
      await errorOf(await remove(owner.cookie, orgId, run.id, approved.lines[0]?.id ?? "")),
    ).toMatchObject({
      code: "payroll_run_status",
    });
  });

  it("AC-08.2 AC-08.4 records each line's signature before sending, makes the run executing with the initiator's approval, and stops it as partially settled", async () => {
    const { owner, orgId, people } = await setUp([await readyWallet(), await readyWallet()]);
    const run = await draftRun(owner.cookie, orgId, people);
    const [first, second] = run.lines as [LineView, LineView];
    const signature = randomSignature();
    // Nothing is sent before authorization.
    expect(
      await errorOf(
        await executeLine(owner.cookie, orgId, run.id, first.id, {
          status: "sent",
          attemptNo: 1,
          signature,
          transfer: true,
        }),
      ),
    ).toMatchObject({ code: "payroll_run_status" });
    expect((await authorizeAs(owner.cookie, orgId, run.id)).status).toBe(200);
    const sent = await executeLine(owner.cookie, orgId, run.id, first.id, {
      status: "sent",
      attemptNo: 1,
      signature,
      transfer: true,
    });
    expect(sent.status).toBe(200);
    const { run: executing } = (await sent.json()) as { run: RunView };
    expect(executing.status).toBe("executing");
    expect(executing.executedAt).not.toBeNull();
    // Q-11, 13 A31: running the payroll is the initiator's approval, with the execution signature.
    expect(executing.approvals.execution?.signature).toBe(signature);
    expect(executing.lines[0]).toMatchObject({
      status: "executing",
      attempts: [{ attemptNo: 1, status: "sent", transferSignature: signature }],
    });
    // An attempt opens only as the next number.
    expect(
      await errorOf(
        await executeLine(owner.cookie, orgId, run.id, second.id, {
          status: "sent",
          attemptNo: 2,
          signature: randomSignature(),
          transfer: true,
        }),
      ),
    ).toMatchObject({ code: "payment_status" });
    const stopped = await executeRun(owner.cookie, orgId, run.id, {
      status: "stopped",
      errorCode: "transfer:1",
    });
    expect(((await stopped.json()) as { run: RunView }).run.status).toBe("partially_settled");
    expect(logs.some((entry) => entry.includes('"event":"payroll_run_stopped"'))).toBe(true);
    // The runs list counts the lines that settled (the worker settles them at finality).
    await test.db.update(payments).set({ status: "settled" }).where(eq(payments.id, first.id));
    const listed = await runs.GET(
      jsonRequest(`/api/orgs/${orgId}/payroll-runs`, "GET", owner.cookie),
      params({ id: orgId }),
    );
    expect(((await listed.json()) as { runs: unknown[] }).runs).toMatchObject([
      { id: run.id, status: "partially_settled", lineCount: 2, settled: 1 },
    ]);

    // A run stopped before any line landed is not paid.
    const other = await draftRun(owner.cookie, orgId, people);
    expect((await authorizeAs(owner.cookie, orgId, other.id)).status).toBe(200);
    const none = await executeRun(owner.cookie, orgId, other.id, {
      status: "stopped",
      errorCode: "signing",
    });
    expect(((await none.json()) as { run: RunView }).run.status).toBe("failed");
  });

  it("AC-08.5 a resume reads the chain first: a line whose transfer landed is never authorized again, the others are", async () => {
    const { owner, orgId, people } = await setUp([
      await readyWallet(),
      await readyWallet(),
      await readyWallet(),
    ]);
    const run = await draftRun(owner.cookie, orgId, people);
    expect((await authorizeAs(owner.cookie, orgId, run.id)).status).toBe(200);
    const [first, second] = run.lines as [LineView, LineView, LineView];
    const one = randomSignature();
    const two = randomSignature();
    for (const [item, signature] of [
      [first, one],
      [second, two],
    ] as const) {
      await executeLine(owner.cookie, orgId, run.id, item.id, {
        status: "sent",
        attemptNo: 1,
        signature,
        transfer: true,
      });
    }
    await executeLine(owner.cookie, orgId, run.id, second.id, {
      status: "failed_clean",
      attemptNo: 1,
      errorCode: "transfer:1",
      signatures: [two],
    });
    await executeRun(owner.cookie, orgId, run.id, { status: "stopped", errorCode: "transfer:1" });
    expect((await read(owner.cookie, orgId, run.id)).status).toBe("partially_settled");

    // Line 1's transfer landed after the page stopped; line 2's never did.
    landed.set(one, { err: null });
    const resumed = await authorizeAs(owner.cookie, orgId, run.id);
    expect(resumed.status).toBe(200);
    const { run: again } = (await resumed.json()) as { run: RunView };
    expect(again.status).toBe("approved");
    expect(again.lines.map((item) => item.status)).toEqual([
      "executing",
      "authorized",
      "authorized",
    ]);
    // Line 1 is never sent again: it has no authorized attempt to open.
    expect(
      await errorOf(
        await executeLine(owner.cookie, orgId, run.id, first.id, {
          status: "sent",
          attemptNo: 2,
          signature: randomSignature(),
          transfer: true,
        }),
      ),
    ).toMatchObject({ code: "payment_status" });
    expect(
      (
        await executeLine(owner.cookie, orgId, run.id, second.id, {
          status: "sent",
          attemptNo: 2,
          signature: randomSignature(),
          transfer: true,
        })
      ).status,
    ).toBe(200);
  });

  it("Q-12 (a) counts the initiator's execution as the run's default approval, and with a policy of 2 needs another member's signed message over the run's current contents", async () => {
    const { owner, orgId, people } = await setUp([await readyWallet(), await readyWallet()]);
    await test.db
      .update(orgPolicy)
      .set({ payrollApprovalsRequired: 2 })
      .where(eq(orgPolicy.orgId, orgId));
    const run = await draftRun(owner.cookie, orgId, people);
    expect(run.approvals).toMatchObject({ required: 2, messages: 0 });
    expect(await errorOf(await authorizeAs(owner.cookie, orgId, run.id))).toEqual({
      code: "approvals_missing",
      message: "This payroll run needs 1 more approval",
    });
    expect((await read(owner.cookie, orgId, run.id)).status).toBe("awaiting_approval");

    const approver = await createKeyUser(test);
    await test.db.insert(memberships).values({ orgId, userId: approver.userId, role: "approver" });
    const message = (hash: string) =>
      approvalMessage({
        orgId,
        cluster: "devnet",
        subjectType: "payroll_run",
        subjectId: run.id,
        contentsHash: hash,
      });
    const sign = async (who: typeof approver, text: string) =>
      Buffer.from(await who.sign(new TextEncoder().encode(text))).toString("base64");
    const post = async (who: typeof approver, text: string) =>
      approve.POST(
        jsonRequest("/api/approvals", "POST", who.cookie, {
          subjectType: "payroll_run",
          subjectId: run.id,
          message: text,
          signature: await sign(who, text),
        }),
      );
    // The initiator's own message does not count as a second approval.
    expect(await errorOf(await post(owner, message(run.contentsHash)))).toMatchObject({
      code: "approval_by_initiator",
    });
    expect(await errorOf(await post(approver, message("ab".repeat(32))))).toMatchObject({
      code: "approval_message_mismatch",
    });
    expect((await post(approver, message(run.contentsHash))).status).toBe(201);
    expect((await read(owner.cookie, orgId, run.id)).approvals.messages).toBe(1);

    // Any change to the run invalidates the approval (D-04).
    const extra = await readyWallet();
    const [third] = await test.db
      .insert(recipients)
      .values({ orgId, displayName: "Third", wallet: extra })
      .returning();
    if (!third) throw new Error("recipient not created");
    const bigger = await draftRun(owner.cookie, orgId, [...people, third]);
    await remove(owner.cookie, orgId, bigger.id, bigger.lines[2]?.id ?? "");
    expect((await read(owner.cookie, orgId, bigger.id)).approvals.messages).toBe(0);

    const authorized = await authorizeAs(owner.cookie, orgId, run.id);
    expect(authorized.status).toBe(200);
    await remove(owner.cookie, orgId, run.id, run.lines[1]?.id ?? "").then(async (response) =>
      expect(await errorOf(response)).toMatchObject({ code: "payroll_run_status" }),
    );
  });

  it("refuses without the proof program, and keeps runs to the org's owner", async () => {
    const { owner, orgId, people } = await setUp([await readyWallet()]);
    const run = await draftRun(owner.cookie, orgId, people);
    await proofProgram(false);
    expect(await errorOf(await authorizeAs(owner.cookie, orgId, run.id))).toMatchObject({
      code: "proof_program_unavailable",
    });
    await proofProgram(true);
    const stranger = await setUp([await readyWallet()]);
    const denied = await one.GET(
      jsonRequest(`/api/orgs/${orgId}/payroll-runs/${run.id}`, "GET", stranger.owner.cookie),
      params({ id: orgId, rid: run.id }),
    );
    expect(denied.status).toBe(403);
    const recipient = await createKeyUser(test);
    await test.db
      .insert(memberships)
      .values({ orgId, userId: recipient.userId, role: "recipient" });
    const asRecipient = await one.GET(
      jsonRequest(`/api/orgs/${orgId}/payroll-runs/${run.id}`, "GET", recipient.cookie),
      params({ id: orgId, rid: run.id }),
    );
    expect(asRecipient.status).toBe(403);
    const missing = await one.GET(
      jsonRequest(`/api/orgs/${orgId}/payroll-runs/${randomUUID()}`, "GET", owner.cookie),
      params({ id: orgId, rid: randomUUID() }),
    );
    expect(missing.status).toBe(404);
    const anonymous = await create(null, orgId, body(people));
    expect(anonymous.status).toBe(401);
  });
});
