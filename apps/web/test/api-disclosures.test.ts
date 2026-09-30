// Disclosures (07 sections 3 to 7, 08 section 3; step 1.8): the server stores a batch only when the
// org owner's wallet signed its manifest for this org and the manifest lists exactly the posted items
// with the SHA-256 of each ciphertext, and only for viewers the org shares with (the owner, a current
// recipient for payments and payslip lines, AC-06.4, or an active grant covering the kind, 07 section
// 6); each viewer reads its own items with their manifests, which verify in the client (I-9); the money
// gate of AC-02.2. Since step 2.4 an item's subject must be what its viewer may see (a recipient's own
// payment; a grant's scope, with a period's dates and own payslips), an expired or revoked grant
// opens nothing, a read records the grant's last use, and each batch is in the access log.
import { createHash, randomUUID } from "node:crypto";
import {
  accessLog,
  grants,
  invites,
  memberships,
  payments,
  payrollRuns,
  recipients,
} from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import {
  buildManifest,
  itemInManifest,
  manifestMessage,
  validateManifest,
  verifyManifest,
  type DisclosurePayloadV1,
} from "@sotto/sdk/disclosure";
import { openPayload, sealPayload } from "@sotto/sdk/disclosure/seal";
import { viewerKeypair } from "@sotto/sdk/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../app/api/orgs/[id]/disclosures/route.ts";
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

function payload(org: string, kind: DisclosurePayloadV1["kind"]): DisclosurePayloadV1 {
  return {
    v: 1,
    org,
    kind,
    direction: "out",
    category: "payroll",
    subject: randomUUID(),
    amount: "9400000000",
    currency: "USDC",
    memo: null,
    gross: null,
    tax: null,
    counterparty: "Maya Chen",
    signatures: [],
    created_at: "2026-09-27T12:00:00.000Z",
  };
}

/** Step 2.12: a day's balance snapshot, available in `amount` and pending in `pending`. */
function snapshotPayload(org: string, day: string): DisclosurePayloadV1 {
  return {
    v: 1,
    org,
    kind: "balance_snapshot",
    direction: "in",
    category: "other",
    subject: day,
    amount: "32199481",
    currency: "USDC",
    memo: null,
    gross: null,
    tax: null,
    counterparty: null,
    signatures: [],
    created_at: `${day}T08:00:00.000Z`,
    pending: "1500000",
  };
}

/** The subjects items name in each org: a settled single payment and payroll line to the recipient. */
const subjectsOf = new Map<string, { payment: string; line: string }>();

/** A settled payment to a recipient: a single payment or a payroll line of a run of its own. */
async function settledPayment(input: {
  orgId: string;
  ownerId: string;
  recipientId: string;
  kind: "single" | "payroll_line";
  settledAt?: Date;
}): Promise<string> {
  let runId: string | null = null;
  if (input.kind === "payroll_line") {
    const [run] = await test.db
      .insert(payrollRuns)
      .values({
        orgId: input.orgId,
        title: "September payroll",
        period: "2026-09",
        idempotencyKey: randomUUID(),
        lineCount: 1,
        createdBy: input.ownerId,
        status: "settled",
      })
      .returning({ id: payrollRuns.id });
    runId = run?.id ?? null;
  }
  const [row] = await test.db
    .insert(payments)
    .values({
      orgId: input.orgId,
      kind: input.kind,
      runId,
      lineNo: runId ? 1 : null,
      recipientId: input.recipientId,
      idempotencyKey: randomUUID(),
      createdBy: input.ownerId,
      privateBlob: Buffer.alloc(96, 3),
      status: "settled",
      settledAt: input.settledAt ?? new Date(),
    })
    .returning({ id: payments.id });
  if (!row) throw new Error("payment not created");
  return row.id;
}

/** An active grant created through an accepted invite, as 07 section 7 requires. */
async function activeGrant(input: {
  orgId: string;
  ownerId: string;
  viewerId: string;
  scope: "all_payments" | "payroll_only" | "own_payslips" | "period";
  recipientId?: string;
  periodFrom?: string;
  periodTo?: string;
  expiresAt?: Date;
}): Promise<string> {
  const token = createHash("sha256").update(randomUUID()).digest("hex");
  await test.db.insert(invites).values({
    token,
    orgId: input.orgId,
    role: input.recipientId ? "recipient" : "accountant",
    recipientId: input.recipientId ?? null,
    createdBy: input.ownerId,
    expiresAt: new Date(Date.now() + 3600_000),
    acceptedBy: input.viewerId,
    acceptedAt: new Date(),
  });
  const [grant] = await test.db
    .insert(grants)
    .values({
      orgId: input.orgId,
      viewerUserId: input.viewerId,
      inviteToken: token,
      scope: input.scope,
      periodFrom: input.periodFrom ?? null,
      periodTo: input.periodTo ?? null,
      expiresAt: input.expiresAt ?? null,
      status: "active",
      createdBy: input.ownerId,
    })
    .returning({ id: grants.id });
  if (!grant) throw new Error("grant not created");
  return grant.id;
}

/**
 * An active org with its owner, a recipient member with the own_payslips grant its invite created, and
 * an accountant holding an active grant of `scope`.
 */
async function setUp(scope: "all_payments" | "payroll_only" = "all_payments") {
  const owner = await createKeyUser(test);
  const orgId = await createOrgWithStatus(test, owner.userId, "active");
  const recipient = await createKeyUser(test);
  await test.db.insert(memberships).values({ orgId, userId: recipient.userId, role: "recipient" });
  const [recipientRow] = await test.db
    .insert(recipients)
    .values({ orgId, displayName: "Maya Chen", wallet: recipient.wallet, userId: recipient.userId })
    .returning({ id: recipients.id });
  if (!recipientRow) throw new Error("recipient not created");
  const payslipsGrantId = await activeGrant({
    orgId,
    ownerId: owner.userId,
    viewerId: recipient.userId,
    scope: "own_payslips",
    recipientId: recipientRow.id,
  });
  const accountant = await createKeyUser(test);
  await test.db
    .insert(memberships)
    .values({ orgId, userId: accountant.userId, role: "accountant" });
  const grantId = await activeGrant({
    orgId,
    ownerId: owner.userId,
    viewerId: accountant.userId,
    scope,
  });
  const common = { orgId, ownerId: owner.userId, recipientId: recipientRow.id };
  subjectsOf.set(orgId, {
    payment: await settledPayment({ ...common, kind: "single" }),
    line: await settledPayment({ ...common, kind: "payroll_line" }),
  });
  return {
    owner,
    orgId,
    recipient,
    recipientRowId: recipientRow.id,
    payslipsGrantId,
    accountant,
    grantId,
  };
}

type Item = {
  id: string;
  viewerUserId: string;
  grantId: string | null;
  kind: DisclosurePayloadV1["kind"];
  subject: string;
  ciphertext: Uint8Array;
};

async function item(
  orgId: string,
  viewerUserId: string,
  grantId: string | null,
  kind: DisclosurePayloadV1["kind"] = "payroll_line",
  subject?: string,
): Promise<Item & { keys: Awaited<ReturnType<typeof viewerKeypair>> }> {
  const keys = await viewerKeypair();
  const known = subjectsOf.get(orgId);
  // Step 2.12: a balance snapshot names today's UTC day and holds its pending balance.
  if (kind === "balance_snapshot") {
    const day = subject ?? new Date().toISOString().slice(0, 10);
    return {
      id: randomUUID(),
      viewerUserId,
      grantId,
      kind,
      subject: day,
      ciphertext: await sealPayload(snapshotPayload(orgId, day), keys.publicKey),
      keys,
    };
  }
  const body = {
    ...payload(orgId, kind),
    subject:
      subject ??
      (kind === "payment" ? known?.payment : kind === "payroll_line" ? known?.line : "2026-09") ??
      randomUUID(),
  };
  return {
    id: randomUUID(),
    viewerUserId,
    grantId,
    kind,
    subject: body.subject,
    ciphertext: await sealPayload(body, keys.publicKey),
    keys,
  };
}

/** A batch the signer signs over a manifest for `manifestOrg` listing `listed` (default: the items). */
async function batch(signer: KeyUser, manifestOrg: string, items: Item[], listed: Item[] = items) {
  const manifest = await buildManifest({
    org: manifestOrg,
    createdAt: new Date().toISOString(),
    items: listed.map((entry) => ({
      id: entry.id,
      viewer: entry.viewerUserId,
      ciphertext: entry.ciphertext,
    })),
  });
  return {
    manifest,
    signature: Buffer.from(await signer.sign(await manifestMessage(manifest))).toString("base64"),
    items: items.map((entry) => ({
      id: entry.id,
      viewerUserId: entry.viewerUserId,
      grantId: entry.grantId,
      kind: entry.kind,
      subject: entry.subject,
      ciphertext: Buffer.from(entry.ciphertext).toString("base64"),
    })),
  };
}

const post = (cookie: string | null, orgId: string, body: unknown) =>
  POST(jsonRequest(`/api/orgs/${orgId}/disclosures`, "POST", cookie, body), {
    params: Promise.resolve({ id: orgId }),
  });
const get = (cookie: string | null, orgId: string, query = "") =>
  GET(jsonRequest(`/api/orgs/${orgId}/disclosures${query}`, "GET", cookie), {
    params: Promise.resolve({ id: orgId }),
  });

describe("disclosures", () => {
  it("stores a batch the owner signed and gives each viewer only its own items, whose manifest verifies (I-9)", async () => {
    const { owner, orgId, recipient, payslipsGrantId, accountant, grantId } = await setUp();
    const own = await item(orgId, owner.userId, null, "payment");
    const theirs = await item(orgId, recipient.userId, payslipsGrantId, "payroll_line");
    const shared = await item(orgId, accountant.userId, grantId, "payment");
    const created = await post(
      owner.cookie,
      orgId,
      await batch(owner, orgId, [own, theirs, shared]),
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ count: 3, manifestId: expect.any(String) });

    for (const [viewer, expected] of [
      [owner, own],
      [recipient, theirs],
      [accountant, shared],
    ] as const) {
      const read = (await (await get(viewer.cookie, orgId)).json()) as {
        items: { id: string; ciphertext: string; manifestId: string }[];
        manifests: { id: string; manifest: unknown; signature: string; signerWallet: string }[];
      };
      expect(read.items.map((row) => row.id)).toEqual([expected.id]);
      const [row] = read.items;
      const stored = read.manifests.find((entry) => entry.id === row?.manifestId);
      if (!row || !stored) throw new Error("item or manifest missing");
      // The client trusts the item only after these checks (07 section 4).
      const manifest = validateManifest(stored.manifest);
      expect(stored.signerWallet).toBe(owner.wallet);
      expect(
        await verifyManifest({
          manifest,
          signature: new Uint8Array(Buffer.from(stored.signature, "base64")),
          ownerWallet: owner.wallet,
          org: orgId,
        }),
      ).toEqual({ ok: true });
      const ciphertext = new Uint8Array(Buffer.from(row.ciphertext, "base64"));
      expect(
        await itemInManifest(manifest, { id: row.id, viewer: viewer.userId, ciphertext }),
      ).toBe(true);
      expect((await openPayload(ciphertext, expected.keys)).subject).toBe(expected.subject);
    }
  });

  it("refuses another signer, another org, a tampered ciphertext, items the manifest does not list and a malformed manifest", async () => {
    const { owner, orgId, recipient, payslipsGrantId } = await setUp();
    const stranger = await createKeyUser(test);
    const valid = await item(orgId, recipient.userId, payslipsGrantId);
    const signedByStranger = await post(owner.cookie, orgId, await batch(stranger, orgId, [valid]));
    expect(signedByStranger.status).toBe(422);
    expect(await errorOf(signedByStranger)).toEqual({
      code: "manifest_invalid",
      message: "The manifest is not signed by the organization owner's wallet",
    });
    const otherOrg = await post(
      owner.cookie,
      orgId,
      await batch(owner, "7c2a9e41-1b2c-4f0e-8a77-3d5e6f708192", [valid]),
    );
    expect(await errorOf(otherOrg)).toEqual({
      code: "manifest_invalid",
      message: "The manifest names another organization",
    });
    const tampered = await batch(owner, orgId, [valid]);
    const bytes = Buffer.from(tampered.items[0]?.ciphertext ?? "", "base64");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    tampered.items[0] = {
      ...(tampered.items[0] as (typeof tampered.items)[number]),
      ciphertext: bytes.toString("base64"),
    };
    expect(await errorOf(await post(owner.cookie, orgId, tampered))).toMatchObject({
      code: "disclosure_mismatch",
    });
    const extra = await item(orgId, recipient.userId, payslipsGrantId);
    expect(
      await errorOf(
        await post(owner.cookie, orgId, await batch(owner, orgId, [valid, extra], [valid])),
      ),
    ).toMatchObject({ code: "disclosure_mismatch" });
    const malformed = await batch(owner, orgId, [valid]);
    const response = await post(owner.cookie, orgId, { ...malformed, manifest: { v: 2 } });
    expect(response.status).toBe(400);
    expect((await get(recipient.cookie, orgId)).status).toBe(200);
    expect(
      ((await (await get(recipient.cookie, orgId)).json()) as { items: unknown[] }).items,
    ).toEqual([]);
  });

  it("refuses viewers the organization does not share with, and an id that already exists", async () => {
    const { owner, orgId, recipient, payslipsGrantId, accountant, grantId } =
      await setUp("payroll_only");
    const stranger = await createKeyUser(test);
    const refused = async (entry: Item) =>
      errorOf(await post(owner.cookie, orgId, await batch(owner, orgId, [entry])));
    expect(await refused(await item(orgId, stranger.userId, null))).toMatchObject({
      code: "disclosure_not_allowed",
    });
    // Without a grant a recipient receives the disclosure of a payment to them (AC-06.4) and payslip
    // lines, never org level items; a removed recipient receives nothing.
    const receipt = await item(orgId, recipient.userId, null, "payment");
    expect((await post(owner.cookie, orgId, await batch(owner, orgId, [receipt]))).status).toBe(
      201,
    );
    for (const kind of ["balance_snapshot", "month_total"] as const) {
      expect(await refused(await item(orgId, recipient.userId, null, kind))).toMatchObject({
        code: "disclosure_not_allowed",
      });
    }
    await test.db
      .update(memberships)
      .set({ removedAt: new Date() })
      .where(eq(memberships.userId, recipient.userId));
    expect(await refused(await item(orgId, recipient.userId, null, "payment"))).toMatchObject({
      code: "disclosure_not_allowed",
    });
    // own_payslips covers payroll lines only (07 section 6).
    expect(
      await refused(await item(orgId, recipient.userId, payslipsGrantId, "payment")),
    ).toMatchObject({ code: "disclosure_not_allowed" });
    // A payroll_only grant does not cover single payments (07 section 6).
    expect(
      await errorOf(
        await post(
          owner.cookie,
          orgId,
          await batch(owner, orgId, [await item(orgId, accountant.userId, grantId, "payment")]),
        ),
      ),
    ).toMatchObject({ code: "disclosure_not_allowed" });
    // A grant item for another viewer than the grant's.
    expect(
      await errorOf(
        await post(
          owner.cookie,
          orgId,
          await batch(owner, orgId, [await item(orgId, owner.userId, grantId)]),
        ),
      ),
    ).toMatchObject({ code: "disclosure_not_allowed" });
    const line = await item(orgId, accountant.userId, grantId, "payroll_line");
    expect((await post(owner.cookie, orgId, await batch(owner, orgId, [line]))).status).toBe(201);
    expect(
      await errorOf(await post(owner.cookie, orgId, await batch(owner, orgId, [line]))),
    ).toMatchObject({
      code: "disclosure_exists",
    });
    // A revoked grant stops new items.
    await test.db.update(grants).set({ status: "revoked" }).where(eq(grants.id, grantId));
    expect(
      await errorOf(
        await post(
          owner.cookie,
          orgId,
          await batch(owner, orgId, [await item(orgId, accountant.userId, grantId)]),
        ),
      ),
    ).toMatchObject({ code: "disclosure_not_allowed" });
  });

  it("AC-05.2 keeps at most one balance snapshot of the owner per UTC day, for the owner only", async () => {
    const { owner, orgId, accountant, grantId, recipient } = await setUp();
    const refused = async (entries: Item[]) =>
      errorOf(await post(owner.cookie, orgId, await batch(owner, orgId, entries)));
    const today = new Date().toISOString().slice(0, 10);
    const first = await item(orgId, owner.userId, null, "balance_snapshot");
    expect((await post(owner.cookie, orgId, await batch(owner, orgId, [first]))).status).toBe(201);
    // A second one the same day, from another tab or a replay with new ids.
    expect(
      await refused([await item(orgId, owner.userId, null, "balance_snapshot")]),
    ).toMatchObject({ code: "snapshot_exists" });
    // Two for one day in one batch.
    const day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    expect(
      await refused([
        await item(orgId, owner.userId, null, "balance_snapshot", day),
        await item(orgId, owner.userId, null, "balance_snapshot", day),
      ]),
    ).toMatchObject({ code: "snapshot_exists" });
    // Yesterday's is still allowed (a device's clock around midnight), a week ago is not.
    expect(
      (
        await post(
          owner.cookie,
          orgId,
          await batch(owner, orgId, [
            await item(orgId, owner.userId, null, "balance_snapshot", day),
          ]),
        )
      ).status,
    ).toBe(201);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    expect(
      await refused([await item(orgId, owner.userId, null, "balance_snapshot", weekAgo)]),
    ).toMatchObject({ code: "snapshot_date" });
    expect(
      await refused([
        { ...(await item(orgId, owner.userId, null, "balance_snapshot")), subject: "2026-9-1" },
      ]),
    ).toMatchObject({ code: "snapshot_date" });
    // D-27: no grant holder receives snapshots in the hackathon build, even with every amount.
    expect(
      await refused([await item(orgId, accountant.userId, grantId, "balance_snapshot")]),
    ).toMatchObject({ code: "disclosure_not_allowed" });
    expect(
      await refused([await item(orgId, recipient.userId, null, "balance_snapshot")]),
    ).toMatchObject({ code: "disclosure_not_allowed" });
    const listed = (await (await get(owner.cookie, orgId, "?kind=balance_snapshot")).json()) as {
      items: { subject: string }[];
    };
    expect(listed.items.map((row) => row.subject).sort()).toEqual([day, today].sort());
    const one = (await (
      await get(owner.cookie, orgId, "?kind=balance_snapshot&limit=1")
    ).json()) as { items: unknown[] };
    expect(one.items).toHaveLength(1);
  });

  it("filters the caller's items by kind and creation date", async () => {
    const { owner, orgId } = await setUp();
    const payment = await item(orgId, owner.userId, null, "payment");
    const snapshot = await item(orgId, owner.userId, null, "balance_snapshot");
    expect(
      (await post(owner.cookie, orgId, await batch(owner, orgId, [payment, snapshot]))).status,
    ).toBe(201);
    const kinds = async (query: string) =>
      (
        (await (await get(owner.cookie, orgId, query)).json()) as { items: { kind: string }[] }
      ).items
        .map((row) => row.kind)
        .sort();
    expect(await kinds("")).toEqual(["balance_snapshot", "payment"]);
    expect(await kinds("?kind=payment")).toEqual(["payment"]);
    const today = new Date().toISOString().slice(0, 10);
    expect(await kinds(`?from=${today}`)).toEqual(["balance_snapshot", "payment"]);
    expect(await kinds(`?to=${today}`)).toEqual([]);
    expect((await get(owner.cookie, orgId, "?kind=salary")).status).toBe(400);
    expect((await get(owner.cookie, orgId, "?from=27-09-2026")).status).toBe(400);
  });

  it("AC-02.2 lets only the owner of an active org post, and only members of an active org read", async () => {
    const { owner, orgId, recipient, accountant } = await setUp();
    const body = await batch(owner, orgId, [await item(orgId, owner.userId, null)]);
    for (const user of [recipient, accountant, await createKeyUser(test)]) {
      const response = await post(user.cookie, orgId, body);
      expect(response.status).toBe(403);
      expect((await errorOf(response)).code).toBe("forbidden");
    }
    expect((await get((await createKeyUser(test)).cookie, orgId)).status).toBe(403);
    expect((await post(null, orgId, body)).status).toBe(401);
    for (const status of ["pending_review", "suspended"] as const) {
      const other = await createKeyUser(test);
      const otherOrg = await createOrgWithStatus(test, other.userId, status);
      const posted = await post(
        other.cookie,
        otherOrg,
        await batch(other, otherOrg, [await item(otherOrg, other.userId, null)]),
      );
      expect(await errorOf(posted)).toMatchObject({ code: "org_not_active" });
      expect(await errorOf(await get(other.cookie, otherOrg))).toMatchObject({
        code: "org_not_active",
      });
    }
  });

  it("AC-06.4 takes a grant's item only for what its scope covers: a period's settled payments, the viewer's own payslips, never an expired grant", async () => {
    const { owner, orgId, recipient, recipientRowId, payslipsGrantId, accountant } = await setUp();
    const common = { orgId, ownerId: owner.userId, recipientId: recipientRowId };
    const inside = await settledPayment({
      ...common,
      kind: "single",
      settledAt: new Date("2026-08-15T10:00:00Z"),
    });
    const after = await settledPayment({
      ...common,
      kind: "single",
      settledAt: new Date("2026-10-01T00:00:00Z"),
    });
    const q3 = await activeGrant({
      orgId,
      ownerId: owner.userId,
      viewerId: accountant.userId,
      scope: "period",
      periodFrom: "2026-07-01",
      periodTo: "2026-09-30",
    });
    const send = async (entry: Item) =>
      post(owner.cookie, orgId, await batch(owner, orgId, [entry]));
    expect((await send(await item(orgId, accountant.userId, q3, "payment", inside))).status).toBe(
      201,
    );
    expect(
      await errorOf(await send(await item(orgId, accountant.userId, q3, "payment", after))),
    ).toMatchObject({ code: "disclosure_not_allowed" });
    // The item's kind names its subject's kind, and the subject is a payment of this org.
    expect(
      await errorOf(await send(await item(orgId, accountant.userId, q3, "payroll_line", inside))),
    ).toMatchObject({ code: "disclosure_not_allowed" });
    expect(
      await errorOf(await send(await item(orgId, accountant.userId, q3, "payment", randomUUID()))),
    ).toMatchObject({ code: "disclosure_not_allowed" });
    // Own payslips: the viewer's own lines only; another recipient's line is refused.
    const other = await createKeyUser(test);
    await test.db.insert(memberships).values({ orgId, userId: other.userId, role: "recipient" });
    const [otherRow] = await test.db
      .insert(recipients)
      .values({ orgId, displayName: "Idris Kaya", wallet: other.wallet, userId: other.userId })
      .returning({ id: recipients.id });
    if (!otherRow) throw new Error("recipient not created");
    const idrisLine = await settledPayment({
      ...common,
      recipientId: otherRow.id,
      kind: "payroll_line",
    });
    expect(
      await errorOf(
        await send(await item(orgId, recipient.userId, payslipsGrantId, "payroll_line", idrisLine)),
      ),
    ).toMatchObject({ code: "disclosure_not_allowed" });
    // Without a grant, a recipient's item is about a payment to them, never to someone else.
    expect(
      await errorOf(
        await send(await item(orgId, recipient.userId, null, "payroll_line", idrisLine)),
      ),
    ).toMatchObject({ code: "disclosure_not_allowed" });
    // An expired grant covers nothing, before the worker marks it.
    const lapsed = await activeGrant({
      orgId,
      ownerId: owner.userId,
      viewerId: accountant.userId,
      scope: "all_payments",
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(
      await errorOf(await send(await item(orgId, accountant.userId, lapsed, "payment"))),
    ).toMatchObject({ code: "disclosure_not_allowed" });
  });

  it("AC-10.4 gives the viewer nothing of a grant that is revoked or has expired, and a read records the grant's last use", async () => {
    const { owner, orgId, accountant, grantId } = await setUp();
    const shared = await item(orgId, accountant.userId, grantId, "payment");
    expect((await post(owner.cookie, orgId, await batch(owner, orgId, [shared]))).status).toBe(201);
    const ids = async () =>
      (
        (await (await get(accountant.cookie, orgId)).json()) as { items: { id: string }[] }
      ).items.map((row) => row.id);
    expect(await ids()).toEqual([shared.id]);
    const [used] = await test.db.select().from(grants).where(eq(grants.id, grantId));
    expect(used?.lastUsedAt).toBeInstanceOf(Date);
    // Its expiry passed: the item is not returned even though it is still stored.
    await test.db
      .update(grants)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(grants.id, grantId));
    expect(await ids()).toEqual([]);
    await test.db
      .update(grants)
      .set({ expiresAt: null, status: "revoked" })
      .where(eq(grants.id, grantId));
    expect(await ids()).toEqual([]);
  });

  it("AC-14.1 writes each batch to the access log, a back fill as such, with counts and kinds only", async () => {
    const { owner, orgId, recipient, accountant, grantId } = await setUp();
    const own = await item(orgId, owner.userId, null, "payment");
    const theirs = await item(orgId, recipient.userId, null, "payment");
    const created = await post(owner.cookie, orgId, await batch(owner, orgId, [own, theirs]));
    const { manifestId } = (await created.json()) as { manifestId: string };
    const backfill = await item(orgId, accountant.userId, grantId, "payroll_line");
    expect((await post(owner.cookie, orgId, await batch(owner, orgId, [backfill]))).status).toBe(
      201,
    );
    const events = await test.db.select().from(accessLog).where(eq(accessLog.orgId, orgId));
    expect(events.map((event) => [event.action, event.subjectType])).toEqual([
      ["disclosure_batch_created", "manifest"],
      ["grant_backfilled", "grant"],
    ]);
    expect(events[0]).toMatchObject({
      actorUserId: owner.userId,
      subjectId: manifestId,
      metadata: { manifestId, items: 2, kinds: ["payment"], viewers: 2, grants: 0 },
    });
    expect(events[1]).toMatchObject({ subjectId: grantId, metadata: { items: 1, grants: 1 } });
    expect(
      JSON.stringify(events, (_, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).not.toContain("9400000000");
  });
});
