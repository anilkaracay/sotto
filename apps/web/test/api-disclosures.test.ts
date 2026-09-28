// Disclosures (07 sections 3 to 7, 08 section 3; step 1.8): the server stores a batch only when the
// org owner's wallet signed its manifest for this org and the manifest lists exactly the posted items
// with the SHA-256 of each ciphertext, and only for viewers the org shares with (the owner, a current
// recipient for payments and payslip lines, AC-06.4, or an active grant covering the kind, 07 section
// 6); each viewer reads its own items with their manifests, which verify in the client (I-9); the money
// gate of AC-02.2.
import { createHash, randomUUID } from "node:crypto";
import { grants, invites, memberships, recipients } from "@sotto/db";
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

/** An active grant created through an accepted invite, as 07 section 7 requires. */
async function activeGrant(input: {
  orgId: string;
  ownerId: string;
  viewerId: string;
  scope: "all_payments" | "payroll_only" | "own_payslips";
  recipientId?: string;
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
  return { owner, orgId, recipient, payslipsGrantId, accountant, grantId };
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
): Promise<Item & { keys: Awaited<ReturnType<typeof viewerKeypair>> }> {
  const keys = await viewerKeypair();
  const body = payload(orgId, kind);
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
    const { eq } = await import("drizzle-orm");
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
});
