// Accountant books (F-11, step 2.5) against a test database: each accountant's books hold exactly the
// payments their grant's scope covers and the owner shared (all_payments, period and payroll_only),
// with the scope banner's grant, the transfer's accounts and time from chain_activity, the screening,
// the approval and the reconciliation status (AC-11.1, AC-11.3); a revoked grant shows nothing; a
// reconciliation is set by the accountant holding the record or the owner, and logged without an amount
// (AC-11.3); the export event records who, the scope, the row count and the filters, never an amount
// or the search text (AC-11.4). The owner's chain panel reads chain_activity only (AC-05.3), and the
// overview's activity lists payroll lines with single payments and who can read each amount.
import { randomUUID } from "node:crypto";
import {
  accessLog,
  approvals,
  chainActivity,
  memberships,
  paymentAttempts,
  payments,
  payrollRuns,
  recipients,
  screenings,
  forbiddenMetadataKeys,
} from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { buildManifest, manifestMessage } from "@sotto/sdk/disclosure";
import { viewKeyRegistrationMessage } from "@sotto/sdk/keys/public";
import { viewerKeypair } from "@sotto/sdk/testing";
import { getBase58Decoder } from "@solana/kit";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as readActivity } from "../app/api/orgs/[id]/activity/route.ts";
import { GET as readBooks } from "../app/api/orgs/[id]/books/route.ts";
import { GET as readChain } from "../app/api/orgs/[id]/chain-activity/route.ts";
import { POST as postDisclosures } from "../app/api/orgs/[id]/disclosures/route.ts";
import { POST as postExport } from "../app/api/orgs/[id]/exports/route.ts";
import { POST as revoke } from "../app/api/orgs/[id]/grants/[gid]/revoke/route.ts";
import { POST as createGrant } from "../app/api/orgs/[id]/grants/route.ts";
import { PUT as putReconciliation } from "../app/api/orgs/[id]/reconciliations/[pid]/route.ts";
import { GET as readDisclosures } from "../app/api/orgs/[id]/disclosures/route.ts";
import { POST as accept } from "../app/api/invites/[token]/accept/route.ts";
import { POST as registerViewerKey } from "../app/api/viewer-keys/route.ts";
import {
  createKeyUser,
  createOrgWithStatus,
  errorOf,
  jsonRequest,
  setUpApiTest,
  tearDownApiTest,
} from "./helpers/api.ts";

let test: TestDatabase;

beforeAll(async () => {
  test = await setUpApiTest();
});

afterAll(async () => {
  await tearDownApiTest(test);
});

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

type KeyUser = Awaited<ReturnType<typeof createKeyUser>>;
const params = (values: Record<string, string>) => ({ params: Promise.resolve(values) });
const randomAddress = () => getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(32)));
const randomSignature = () => getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(64)));
const ORG_ACCOUNT = randomAddress();

type Books = {
  org: { id: string; displayName: string };
  ownerWallet: string;
  grants: { id: string; scope: string; periodFrom: string | null; grantedBy: { wallet: string } }[];
  payments: {
    id: string;
    kind: string;
    settledAt: string | null;
    chain: { from: string; to: string; signature: string } | null;
    screening: string | null;
    approvedBy: { wallet: string } | null;
    reconciliation: { status: string } | null;
  }[];
};

async function registerKey(user: KeyUser) {
  const keys = await viewerKeypair();
  const response = await registerViewerKey(
    jsonRequest("/api/viewer-keys", "POST", user.cookie, {
      publicKey: Buffer.from(keys.publicKey).toString("base64"),
      signature: Buffer.from(await user.sign(viewKeyRegistrationMessage(keys.publicKey))).toString(
        "base64",
      ),
    }),
  );
  expect(response.status).toBe(201);
}

/** The owner's org with a joined recipient and four settled payments, each with its chain row. */
async function setUp() {
  const owner = await createKeyUser(test);
  const orgId = await createOrgWithStatus(test, owner.userId, "active");
  const person = await createKeyUser(test);
  await test.db.insert(memberships).values({ orgId, userId: person.userId, role: "recipient" });
  const [recipient] = await test.db
    .insert(recipients)
    .values({ orgId, displayName: "Maya Chen", wallet: person.wallet, userId: person.userId })
    .returning({ id: recipients.id });
  if (!recipient) throw new Error("recipient not created");
  await test.db.insert(screenings).values({
    orgId,
    wallet: person.wallet,
    provider: "denylist",
    result: "clear",
    createdAt: new Date("2026-07-01T00:00:00Z"),
  });
  const [run] = await test.db
    .insert(payrollRuns)
    .values({
      orgId,
      title: "August payroll",
      period: "2026-08",
      idempotencyKey: randomUUID(),
      lineCount: 2,
      createdBy: owner.userId,
      status: "settled",
    })
    .returning({ id: payrollRuns.id });
  if (!run) throw new Error("run not created");
  await test.db.insert(approvals).values({
    orgId,
    subjectType: "payroll_run",
    subjectId: run.id,
    approverUserId: owner.userId,
    kind: "execution",
    executionSignature: randomSignature(),
  });
  let lineNo = 0;
  const settle = async (kind: "single" | "payroll_line", settledAt: string) => {
    const [row] = await test.db
      .insert(payments)
      .values({
        orgId,
        kind,
        runId: kind === "payroll_line" ? run.id : null,
        lineNo: kind === "payroll_line" ? (lineNo += 1) : null,
        recipientId: recipient.id,
        idempotencyKey: randomUUID(),
        createdBy: owner.userId,
        privateBlob: Buffer.alloc(96, 4),
        status: "settled",
        settledAt: new Date(settledAt),
      })
      .returning({ id: payments.id });
    if (!row) throw new Error("payment not created");
    const signature = randomSignature();
    await test.db.insert(paymentAttempts).values({
      paymentId: row.id,
      attemptNo: 1,
      signatures: [signature],
      status: "finalized",
      transferSignature: signature,
    });
    await test.db.insert(chainActivity).values({
      orgId,
      tokenAccount: ORG_ACCOUNT,
      signature,
      slot: BigInt(Date.parse(settledAt) / 1000),
      blockTime: new Date(settledAt),
      instructionIndex: 0,
      instructionType: "transfer_out",
      counterpartyAddress: randomAddress(),
    });
    if (kind === "single") {
      await test.db.insert(approvals).values({
        orgId,
        subjectType: "payment",
        subjectId: row.id,
        approverUserId: owner.userId,
        kind: "execution",
        executionSignature: signature,
      });
    }
    return row.id;
  };
  const julySingle = await settle("single", "2026-07-15T10:00:00Z");
  const augustLine = await settle("payroll_line", "2026-08-31T10:00:00Z");
  const octoberSingle = await settle("single", "2026-10-02T10:00:00Z");
  const octoberLine = await settle("payroll_line", "2026-10-03T10:00:00Z");
  const all = { julySingle, augustLine, octoberSingle, octoberLine };
  const kindOf = (id: string) =>
    id === augustLine || id === octoberLine ? ("payroll_line" as const) : ("payment" as const);
  /** Items under one manifest the owner signs: the owner's own or a grant's. */
  const store = async (viewerUserId: string, grantId: string | null, subjects: string[]) => {
    const items = subjects.map((subject) => ({
      id: randomUUID(),
      kind: kindOf(subject),
      subject,
      ciphertext: crypto.getRandomValues(new Uint8Array(160)),
    }));
    const manifest = await buildManifest({
      org: orgId,
      createdAt: new Date().toISOString(),
      items: items.map((item) => ({
        id: item.id,
        viewer: viewerUserId,
        ciphertext: item.ciphertext,
      })),
    });
    const response = await postDisclosures(
      jsonRequest(`/api/orgs/${orgId}/disclosures`, "POST", owner.cookie, {
        manifest,
        signature: Buffer.from(await owner.sign(await manifestMessage(manifest))).toString(
          "base64",
        ),
        items: items.map((item) => ({
          id: item.id,
          viewerUserId,
          grantId,
          kind: item.kind,
          subject: item.subject,
          ciphertext: Buffer.from(item.ciphertext).toString("base64"),
        })),
      }),
      params({ id: orgId }),
    );
    expect(response.status).toBe(201);
  };
  await store(owner.userId, null, Object.values(all));
  /** A grant created through its invite, accepted by a new accountant with a viewing key. */
  const grantTo = async (body: Record<string, unknown>) => {
    const created = (await (
      await createGrant(
        jsonRequest(`/api/orgs/${orgId}/grants`, "POST", owner.cookie, {
          holderName: "Daniel Osei",
          expiry: "none",
          ...body,
        }),
        params({ id: orgId }),
      )
    ).json()) as { grant: { id: string }; invite: { url: string } };
    const accountant = await createKeyUser(test);
    await registerKey(accountant);
    const token = created.invite.url.split("/app/invite/")[1] ?? "";
    expect(
      (
        await accept(
          jsonRequest(`/api/invites/${token}/accept`, "POST", accountant.cookie),
          params({ token }),
        )
      ).status,
    ).toBe(200);
    return { accountant, grantId: created.grant.id };
  };
  return { owner, orgId, person, all, store, grantTo };
}

const booksOf = async (user: KeyUser, orgId: string) =>
  readBooks(jsonRequest(`/api/orgs/${orgId}/books`, "GET", user.cookie), params({ id: orgId }));

describe("accountant books (F-11)", () => {
  it("AC-11.1 AC-11.2 gives each accountant exactly the payments their scope covers: every amount, one period and payroll only", async () => {
    const { owner, orgId, all, store, grantTo } = await setUp();
    const every = await grantTo({ scope: "all_payments" });
    const quarter = await grantTo({
      scope: "period",
      periodFrom: "2026-07-01",
      periodTo: "2026-09-30",
    });
    const payroll = await grantTo({ scope: "payroll_only" });
    await store(every.accountant.userId, every.grantId, Object.values(all));
    await store(quarter.accountant.userId, quarter.grantId, [all.julySingle, all.augustLine]);
    await store(payroll.accountant.userId, payroll.grantId, [all.augustLine, all.octoberLine]);

    for (const [holder, expected] of [
      [every, Object.values(all)],
      [quarter, [all.julySingle, all.augustLine]],
      [payroll, [all.augustLine, all.octoberLine]],
    ] as const) {
      const response = await booksOf(holder.accountant, orgId);
      expect(response.status).toBe(200);
      const books = (await response.json()) as Books;
      expect(books.payments.map((payment) => payment.id).sort()).toEqual([...expected].sort());
      // The scope banner: the holder's grant, granted by the owner.
      expect(books.grants).toEqual([
        expect.objectContaining({
          id: holder.grantId,
          grantedBy: expect.objectContaining({ wallet: owner.wallet }),
        }),
      ]);
      expect(books.ownerWallet).toBe(owner.wallet);
      for (const payment of books.payments) {
        expect(payment.chain).toMatchObject({ from: ORG_ACCOUNT });
        expect(payment.screening).toBe("clear");
        expect(payment.approvedBy?.wallet).toBe(owner.wallet);
        expect(payment.reconciliation).toBeNull();
      }
      expect(JSON.stringify(books)).not.toMatch(/amount/i);
    }
    // The owner and a stranger have no books here.
    expect(await errorOf(await booksOf(owner, orgId))).toMatchObject({ code: "forbidden" });
    expect(await errorOf(await booksOf(await createKeyUser(test), orgId))).toMatchObject({
      code: "forbidden",
    });
  });

  it("AC-11.1 shows a revoked grant's holder nothing", async () => {
    const { owner, orgId, all, store, grantTo } = await setUp();
    const every = await grantTo({ scope: "all_payments" });
    await store(every.accountant.userId, every.grantId, Object.values(all));
    expect((await booksOf(every.accountant, orgId)).status).toBe(200);
    await revoke(
      jsonRequest(`/api/orgs/${orgId}/grants/${every.grantId}/revoke`, "POST", owner.cookie),
      params({ id: orgId, gid: every.grantId }),
    );
    expect(await errorOf(await booksOf(every.accountant, orgId))).toMatchObject({
      code: "books_no_grant",
    });
    const records = (await (
      await readDisclosures(
        jsonRequest(`/api/orgs/${orgId}/disclosures`, "GET", every.accountant.cookie),
        params({ id: orgId }),
      )
    ).json()) as { items: unknown[] };
    expect(records.items).toEqual([]);
  });

  it("AC-11.3 lets the accountant holding the record, or the owner, set a payment's reconciliation status, logged without an amount", async () => {
    const { owner, orgId, all, store, grantTo } = await setUp();
    const quarter = await grantTo({
      scope: "period",
      periodFrom: "2026-07-01",
      periodTo: "2026-09-30",
    });
    await store(quarter.accountant.userId, quarter.grantId, [all.julySingle]);
    const put = (user: KeyUser, paymentId: string, status: string) =>
      putReconciliation(
        jsonRequest(`/api/orgs/${orgId}/reconciliations/${paymentId}`, "PUT", user.cookie, {
          status,
        }),
        params({ id: orgId, pid: paymentId }),
      );
    expect((await put(quarter.accountant, all.julySingle, "matched")).status).toBe(200);
    // A payment the accountant holds no record of, and a status outside the two.
    expect(
      await errorOf(await put(quarter.accountant, all.octoberSingle, "matched")),
    ).toMatchObject({
      code: "payment_not_found",
    });
    expect((await put(quarter.accountant, all.julySingle, "reconciled")).status).toBe(400);
    expect((await put(owner, all.octoberSingle, "needs_receipt")).status).toBe(200);
    const books = (await (await booksOf(quarter.accountant, orgId)).json()) as Books;
    expect(
      books.payments.find((payment) => payment.id === all.julySingle)?.reconciliation,
    ).toMatchObject({
      status: "matched",
    });
    const events = await test.db
      .select()
      .from(accessLog)
      .where(and(eq(accessLog.orgId, orgId), eq(accessLog.action, "reconciliation_updated")));
    expect(events.map((event) => event.metadata)).toEqual([
      { status: "matched" },
      { status: "needs_receipt" },
    ]);
  });

  it("AC-11.4 records the export event with who, the scope, the row count and the filters, never an amount or the search text", async () => {
    const { orgId, all, store, grantTo } = await setUp();
    const every = await grantTo({ scope: "all_payments" });
    await store(every.accountant.userId, every.grantId, Object.values(all));
    const post = (body: Record<string, unknown>) =>
      postExport(
        jsonRequest(`/api/orgs/${orgId}/exports`, "POST", every.accountant.cookie, body),
        params({ id: orgId }),
      );
    const body = {
      grantId: every.grantId,
      rows: 4,
      month: "2026-10",
      category: null,
      needsReceipt: false,
      searched: true,
    };
    expect((await post(body)).status).toBe(201);
    // The search text never reaches the server; a grant the caller does not hold is refused.
    expect((await post({ ...body, search: "9400" })).status).toBe(400);
    expect(await errorOf(await post({ ...body, grantId: randomUUID() }))).toMatchObject({
      code: "books_no_grant",
    });
    const [event] = await test.db
      .select()
      .from(accessLog)
      .where(and(eq(accessLog.orgId, orgId), eq(accessLog.action, "export_created")));
    expect(event).toMatchObject({
      actorUserId: every.accountant.userId,
      subjectType: "export",
      subjectId: every.grantId,
      metadata: {
        rows: 4,
        scope: "all_payments",
        periodFrom: null,
        periodTo: null,
        month: "2026-10",
        category: null,
        needsReceipt: false,
        searched: true,
      },
    });
    expect(forbiddenMetadataKeys(event?.metadata)).toEqual([]);
  });

  it("AC-05.3 gives the owner what the chain shows from chain_activity only", async () => {
    const { owner, orgId, grantTo } = await setUp();
    const deposit = randomSignature();
    await test.db.insert(chainActivity).values({
      orgId,
      tokenAccount: ORG_ACCOUNT,
      signature: deposit,
      slot: 9_999_999_999n,
      instructionIndex: 1,
      instructionType: "deposit",
      publicAmountBaseUnits: 20_000_000n,
    });
    const read = (user: KeyUser) =>
      readChain(
        jsonRequest(`/api/orgs/${orgId}/chain-activity?limit=5`, "GET", user.cookie),
        params({ id: orgId }),
      );
    const { activity } = (await (await read(owner)).json()) as {
      activity: {
        signature: string;
        type: string;
        publicAmount: string | null;
        counterparty: string | null;
      }[];
    };
    const rows = await test.db.select().from(chainActivity).where(eq(chainActivity.orgId, orgId));
    // The newest row first; every row is one of the table's, nothing else.
    expect(activity[0]).toMatchObject({
      signature: deposit,
      type: "deposit",
      publicAmount: "20000000",
    });
    expect(activity).toHaveLength(5);
    for (const entry of activity) {
      const row = rows.find((candidate) => candidate.signature === entry.signature);
      expect(row?.instructionType).toBe(entry.type);
      expect(entry.publicAmount).toBe(row?.publicAmountBaseUnits?.toString() ?? null);
    }
    expect(
      activity
        .slice(1)
        .every((entry) => entry.type === "transfer_out" && entry.publicAmount === null),
    ).toBe(true);
    const { accountant } = await grantTo({ scope: "all_payments" });
    expect((await read(accountant)).status).toBe(403);
  });

  it("lists payroll lines with single payments on the overview, with who can read each amount", async () => {
    const { owner, orgId, person, all, store, grantTo } = await setUp();
    const every = await grantTo({ scope: "all_payments" });
    await store(every.accountant.userId, every.grantId, [all.octoberSingle, all.augustLine]);
    await store(person.userId, null, [all.octoberLine]);
    const read = async () =>
      (await (
        await readActivity(
          jsonRequest(`/api/orgs/${orgId}/activity?limit=10`, "GET", owner.cookie),
          params({ id: orgId }),
        )
      ).json()) as {
        payments: { id: string; kind: string; readers: { name: string; via: string }[] }[];
        items: { subject: string }[];
      };
    const listed = await read();
    expect(listed.payments.map((payment) => payment.kind).sort()).toEqual([
      "payroll_line",
      "payroll_line",
      "single",
      "single",
    ]);
    const readersOf = (id: string, view = listed) =>
      view.payments.find((payment) => payment.id === id)?.readers;
    expect(readersOf(all.octoberSingle)).toEqual([{ name: "Daniel Osei", via: "grant" }]);
    expect(readersOf(all.octoberLine)).toEqual([{ name: "Maya Chen", via: "recipient" }]);
    expect(readersOf(all.julySingle)).toEqual([]);
    // The owner's own records of the listed payments, for the tab to open.
    expect(new Set(listed.items.map((item) => item.subject))).toEqual(new Set(Object.values(all)));
    await revoke(
      jsonRequest(`/api/orgs/${orgId}/grants/${every.grantId}/revoke`, "POST", owner.cookie),
      params({ id: orgId, gid: every.grantId }),
    );
    expect(readersOf(all.octoberSingle, await read())).toEqual([]);
  });
});
