// Viewing grants (F-10, F-14, 07 sections 6 and 7, 08 section 3; step 2.4) against a test database:
// a grant is created through an invite with one of the hackathon scopes and an expiry, "No expiry"
// included (AC-10.1, X-52); the holder accepts with their wallet, becomes the org's accountant, and
// the grant activates with their viewing key (AC-10.2); the back fill lists the owner's records in
// scope the grant does not have yet (AC-10.3); revoking deletes the grant's records in the same
// transaction (AC-10.4); every change is in the access log, which the owner reads and which holds no
// amount (AC-10.5, AC-14.1).
import { createHash, randomUUID } from "node:crypto";
import {
  accessLog,
  disclosures,
  grants,
  invites,
  memberships,
  payments,
  payrollRuns,
  recipients,
} from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { buildManifest, manifestMessage, type DisclosurePayloadV1 } from "@sotto/sdk/disclosure";
import { sealPayload } from "@sotto/sdk/disclosure/seal";
import { viewKeyRegistrationMessage } from "@sotto/sdk/keys/public";
import { viewerKeypair } from "@sotto/sdk/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as readLog } from "../app/api/orgs/[id]/access-log/route.ts";
import { POST as postDisclosures } from "../app/api/orgs/[id]/disclosures/route.ts";
import { GET as backfill } from "../app/api/orgs/[id]/grants/[gid]/backfill/route.ts";
import { POST as renew } from "../app/api/orgs/[id]/grants/[gid]/invite/route.ts";
import { POST as revoke } from "../app/api/orgs/[id]/grants/[gid]/revoke/route.ts";
import { GET as listGrants, POST as createGrant } from "../app/api/orgs/[id]/grants/route.ts";
import { GET as readRun } from "../app/api/orgs/[id]/payroll-runs/[rid]/route.ts";
import { POST as accept } from "../app/api/invites/[token]/accept/route.ts";
import { GET as readInvite } from "../app/api/invites/[token]/route.ts";
import { POST as registerViewerKey } from "../app/api/viewer-keys/route.ts";
import { expiryFor } from "../lib/server/grants.ts";
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
type GrantView = {
  id: string;
  scope: string;
  status: string;
  expiresAt: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  holder: { name: string; title: string | null };
  viewer: { userId: string; wallet: string; viewerKey: { publicKey: string } | null } | null;
  invite: { status: string; expiresAt: string } | null;
  items: number;
  missing: number;
};

const params = (values: Record<string, string>) => ({ params: Promise.resolve(values) });
const tokenOf = (url: string) => url.split("/app/invite/")[1] ?? "";

async function grant(cookie: string, orgId: string, body: Record<string, unknown>) {
  return createGrant(
    jsonRequest(`/api/orgs/${orgId}/grants`, "POST", cookie, {
      holderName: "Daniel Osei",
      holderTitle: "Accountant, external",
      scope: "all_payments",
      expiry: "end_of_year",
      ...body,
    }),
    params({ id: orgId }),
  );
}

async function grants_(cookie: string, orgId: string) {
  return (await (
    await listGrants(jsonRequest(`/api/orgs/${orgId}/grants`, "GET", cookie), params({ id: orgId }))
  ).json()) as { grants: GrantView[]; ownerItems: number };
}

const acceptAs = (cookie: string, token: string) =>
  accept(jsonRequest(`/api/invites/${token}/accept`, "POST", cookie), params({ token }));

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
  return keys;
}

/** An active org, its owner, a recipient who joined, a settled single payment and payroll line to them. */
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
  const settled = async (kind: "single" | "payroll_line") => {
    let runId: string | null = null;
    if (kind === "payroll_line") {
      const [run] = await test.db
        .insert(payrollRuns)
        .values({
          orgId,
          title: "September payroll",
          period: "2026-09",
          idempotencyKey: randomUUID(),
          lineCount: 1,
          createdBy: owner.userId,
          status: "settled",
        })
        .returning({ id: payrollRuns.id });
      runId = run?.id ?? null;
    }
    const [row] = await test.db
      .insert(payments)
      .values({
        orgId,
        kind,
        runId,
        lineNo: runId ? 1 : null,
        recipientId: recipient.id,
        idempotencyKey: randomUUID(),
        createdBy: owner.userId,
        privateBlob: Buffer.alloc(96, 4),
        status: "settled",
        settledAt: new Date(),
      })
      .returning({ id: payments.id });
    if (!row) throw new Error("payment not created");
    return row.id;
  };
  return {
    owner,
    orgId,
    person,
    payment: await settled("single"),
    line: await settled("payroll_line"),
  };
}

/** The owner's own records of these subjects, under one manifest the owner signs. */
async function ownRecords(
  owner: KeyUser,
  orgId: string,
  subjects: [string, "payment" | "payroll_line"][],
) {
  const keys = await viewerKeypair();
  const items = [];
  for (const [subject, kind] of subjects) {
    const payload: DisclosurePayloadV1 = {
      v: 1,
      org: orgId,
      kind,
      direction: "out",
      category: "payroll",
      subject,
      amount: "7777000000",
      currency: "USDC",
      memo: null,
      gross: null,
      tax: null,
      counterparty: "Maya Chen",
      signatures: [],
      created_at: new Date().toISOString(),
    };
    items.push({
      id: randomUUID(),
      kind,
      subject,
      ciphertext: await sealPayload(payload, keys.publicKey),
    });
  }
  const manifest = await buildManifest({
    org: orgId,
    createdAt: new Date().toISOString(),
    items: items.map((item) => ({
      id: item.id,
      viewer: owner.userId,
      ciphertext: item.ciphertext,
    })),
  });
  const response = await postDisclosures(
    jsonRequest(`/api/orgs/${orgId}/disclosures`, "POST", owner.cookie, {
      manifest,
      signature: Buffer.from(await owner.sign(await manifestMessage(manifest))).toString("base64"),
      items: items.map((item) => ({
        id: item.id,
        viewerUserId: owner.userId,
        grantId: null,
        kind: item.kind,
        subject: item.subject,
        ciphertext: Buffer.from(item.ciphertext).toString("base64"),
      })),
    }),
    params({ id: orgId }),
  );
  expect(response.status).toBe(201);
}

describe("viewing grants", () => {
  it("AC-10.1 creates a grant through an invite with a hackathon scope and an expiry, No expiry included; totals_only and own_payslips are not offered", async () => {
    const { owner, orgId } = await setUp();
    const created = await grant(owner.cookie, orgId, { expiry: "none" });
    expect(created.status).toBe(201);
    const body = (await created.json()) as {
      grant: GrantView;
      invite: { url: string; expiresAt: string };
    };
    expect(body.grant).toMatchObject({
      scope: "all_payments",
      status: "pending_viewer_key",
      expiresAt: null,
      holder: { name: "Daniel Osei", title: "Accountant, external" },
      viewer: null,
      invite: { status: "pending", expiresAt: body.invite.expiresAt },
      items: 0,
      missing: 0,
    });
    // The database keeps the SHA-256 of the link's token, never the token.
    const token = tokenOf(body.invite.url);
    const [stored] = await test.db
      .select()
      .from(invites)
      .where(eq(invites.token, createHash("sha256").update(token).digest("hex")));
    expect(stored).toMatchObject({ role: "accountant", recipientId: null, acceptedAt: null });
    // A period grant needs its dates; the other expiries are computed in UTC.
    const period = await grant(owner.cookie, orgId, {
      scope: "period",
      periodFrom: "2026-07-01",
      periodTo: "2026-09-30",
      expiry: "30_days",
    });
    expect(((await period.json()) as { grant: GrantView }).grant).toMatchObject({
      scope: "period",
      periodFrom: "2026-07-01",
      periodTo: "2026-09-30",
    });
    for (const bad of [
      { scope: "period" },
      { scope: "period", periodFrom: "2026-09-30", periodTo: "2026-07-01" },
      { scope: "all_payments", periodFrom: "2026-07-01", periodTo: "2026-09-30" },
      { scope: "totals_only" },
      { scope: "own_payslips" },
      { expiry: "90_days" },
      { holderName: "" },
    ]) {
      expect((await grant(owner.cookie, orgId, bad)).status).toBe(400);
    }
    const now = new Date("2026-09-29T10:00:00Z");
    expect(expiryFor("30_days", now)).toEqual(new Date("2026-10-29T10:00:00Z"));
    expect(expiryFor("end_of_quarter", now)).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(expiryFor("end_of_quarter", new Date("2026-11-05T00:00:00Z"))).toEqual(
      new Date("2027-01-01T00:00:00Z"),
    );
    expect(expiryFor("end_of_year", now)).toEqual(new Date("2027-01-01T00:00:00Z"));
    expect(expiryFor("none", now)).toBeNull();
    // Only the owner of an active org grants.
    const stranger = await createKeyUser(test);
    expect((await grant(stranger.cookie, orgId, {})).status).toBe(403);
  });

  it("AC-10.2 lets the holder accept with their wallet: they become the org's accountant and the grant activates with their viewing key", async () => {
    const { owner, orgId } = await setUp();
    const created = (await (await grant(owner.cookie, orgId, {})).json()) as {
      grant: GrantView;
      invite: { url: string };
    };
    const token = tokenOf(created.invite.url);
    // Before sign in: the organization and the role only.
    const anonymous = (await (
      await readInvite(jsonRequest(`/api/invites/${token}`, "GET", null), params({ token }))
    ).json()) as { invite: Record<string, unknown> };
    expect(anonymous.invite).toMatchObject({ role: "accountant", status: "open", details: null });
    expect(JSON.stringify(anonymous)).not.toContain("Daniel");
    // The owner reads everything already.
    expect(await errorOf(await acceptAs(owner.cookie, token))).toMatchObject({
      code: "invite_own",
    });
    const accountant = await createKeyUser(test);
    const seen = (await (
      await readInvite(
        jsonRequest(`/api/invites/${token}`, "GET", accountant.cookie),
        params({ token }),
      )
    ).json()) as { invite: Record<string, unknown> };
    expect(seen.invite).toMatchObject({
      details: { role: "accountant", scope: "all_payments", periodFrom: null },
    });
    const accepted = await acceptAs(accountant.cookie, token);
    expect(accepted.status).toBe(200);
    expect(((await accepted.json()) as { accepted: unknown }).accepted).toEqual({
      orgId,
      role: "accountant",
      grant: { status: "pending_viewer_key" },
    });
    const [membership] = await test.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, accountant.userId)));
    expect(membership?.role).toBe("accountant");
    // The link works once.
    expect(await errorOf(await acceptAs((await createKeyUser(test)).cookie, token))).toMatchObject({
      code: "invite_accepted",
    });
    // The viewing key activates the grant.
    await registerKey(accountant);
    const [listed] = (await grants_(owner.cookie, orgId)).grants;
    expect(listed).toMatchObject({
      status: "active",
      viewer: { userId: accountant.userId, wallet: accountant.wallet },
      invite: { status: "accepted" },
    });
    expect(listed?.viewer?.viewerKey?.publicKey).toBeTruthy();
    const events = await test.db.select().from(accessLog).where(eq(accessLog.orgId, orgId));
    expect(events.map((event) => event.action)).toEqual([
      "grant_created",
      "grant_accepted",
      "grant_activated",
    ]);
    // A grant revoked before acceptance withdraws its invite.
    const second = (await (await grant(owner.cookie, orgId, {})).json()) as {
      grant: GrantView;
      invite: { url: string };
    };
    await revoke(
      jsonRequest(`/api/orgs/${orgId}/grants/${second.grant.id}/revoke`, "POST", owner.cookie),
      params({ id: orgId, gid: second.grant.id }),
    );
    const late = await createKeyUser(test);
    expect(await errorOf(await acceptAs(late.cookie, tokenOf(second.invite.url)))).toMatchObject({
      code: "invite_withdrawn",
    });
  });

  it("AC-10.2 shows a wallet that is not the holder yet only the organization, the offered scope and the expiry", async () => {
    const { owner, orgId, person, payment, line } = await setUp();
    await ownRecords(owner, orgId, [
      [payment, "payment"],
      [line, "payroll_line"],
    ]);
    const created = (await (
      await grant(owner.cookie, orgId, {
        scope: "period",
        periodFrom: "2026-07-01",
        periodTo: "2026-09-30",
        expiry: "end_of_year",
      })
    ).json()) as { grant: GrantView; invite: { url: string } };
    const token = tokenOf(created.invite.url);
    const read = async (cookie: string) =>
      (await (
        await readInvite(jsonRequest(`/api/invites/${token}`, "GET", cookie), params({ token }))
      ).json()) as { invite: { org: { displayName: string } } & Record<string, unknown> };
    const leaks = (body: unknown) => {
      const text = JSON.stringify(body);
      return [
        "Daniel",
        "Accountant, external",
        "Maya Chen",
        person.wallet,
        payment,
        line,
        "7777000000",
        created.grant.id,
      ].filter((value) => text.includes(value));
    };
    for (const viewer of [await createKeyUser(test), owner]) {
      const body = await read(viewer.cookie);
      expect(body).toEqual({
        invite: {
          org: { id: orgId, displayName: body.invite.org.displayName },
          role: "accountant",
          status: "open",
          details: {
            role: "accountant",
            scope: "period",
            periodFrom: "2026-07-01",
            periodTo: "2026-09-30",
            grantExpiresAt: created.grant.expiresAt,
          },
          expectedWallet: null,
          acceptedByYou: false,
        },
      });
      expect(leaks(body)).toEqual([]);
    }
    // Once the holder accepted, another wallet learns only that; the holder keeps what they read.
    const accountant = await createKeyUser(test);
    expect((await acceptAs(accountant.cookie, token)).status).toBe(200);
    const later = await read((await createKeyUser(test)).cookie);
    expect(later.invite).toMatchObject({ status: "accepted", details: null });
    expect(leaks(later)).toEqual([]);
    expect((await read(accountant.cookie)).invite).toMatchObject({
      status: "accepted",
      acceptedByYou: true,
      details: { scope: "period", grantExpiresAt: created.grant.expiresAt },
    });
  });

  it("AC-10.4 does not activate a waiting grant whose expiry passed when its holder registers a key", async () => {
    const { owner, orgId } = await setUp();
    const created = (await (await grant(owner.cookie, orgId, { expiry: "30_days" })).json()) as {
      grant: GrantView;
      invite: { url: string };
    };
    const accountant = await createKeyUser(test);
    expect((await acceptAs(accountant.cookie, tokenOf(created.invite.url))).status).toBe(200);
    await test.db
      .update(grants)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(grants.id, created.grant.id));
    await registerKey(accountant);
    const [stored] = await test.db.select().from(grants).where(eq(grants.id, created.grant.id));
    expect(stored).toMatchObject({ status: "pending_viewer_key", activatedAt: null });
    const [listed] = (await grants_(owner.cookie, orgId)).grants;
    expect(listed?.status).toBe("expired");
    const events = await test.db.select().from(accessLog).where(eq(accessLog.orgId, orgId));
    expect(events.map((event) => event.action)).toEqual(["grant_created", "grant_accepted"]);
  });

  it("AC-10.3 lists the owner's records in scope that the grant does not have yet, and nothing once they are shared", async () => {
    const { owner, orgId, payment, line } = await setUp();
    await ownRecords(owner, orgId, [
      [payment, "payment"],
      [line, "payroll_line"],
    ]);
    const created = (await (
      await grant(owner.cookie, orgId, { scope: "payroll_only" })
    ).json()) as {
      grant: GrantView;
      invite: { url: string };
    };
    const accountant = await createKeyUser(test);
    await registerKey(accountant);
    await acceptAs(accountant.cookie, tokenOf(created.invite.url));
    const listed = (await grants_(owner.cookie, orgId)).grants[0];
    expect(listed).toMatchObject({ status: "active", missing: 1, items: 0 });
    const read = async () =>
      (await (
        await backfill(
          jsonRequest(
            `/api/orgs/${orgId}/grants/${created.grant.id}/backfill`,
            "GET",
            owner.cookie,
          ),
          params({ id: orgId, gid: created.grant.id }),
        )
      ).json()) as { items: { id: string; kind: string; subject: string }[]; manifests: unknown[] };
    const pending = await read();
    // payroll_only: the payroll line, not the single payment; with its manifest to verify (I-9).
    expect(pending.items.map((item) => [item.kind, item.subject])).toEqual([
      ["payroll_line", line],
    ]);
    expect(pending.manifests).toHaveLength(1);
    // Once the grant has the line, nothing is left to back fill.
    const [ownerItem] = await test.db
      .select()
      .from(disclosures)
      .where(and(eq(disclosures.orgId, orgId), eq(disclosures.subject, line)));
    if (!ownerItem) throw new Error("the owner's record is missing");
    await test.db.insert(disclosures).values({
      orgId,
      grantId: created.grant.id,
      viewerUserId: accountant.userId,
      kind: "payroll_line",
      subject: line,
      ciphertext: Buffer.alloc(96, 9),
      manifestId: ownerItem.manifestId,
    });
    expect((await read()).items).toEqual([]);
    expect((await grants_(owner.cookie, orgId)).grants[0]).toMatchObject({ missing: 0, items: 1 });
    // 13 A26: the run's "Who can read this run" names the holder with the lines they hold.
    const [{ runId } = { runId: null }] = await test.db
      .select({ runId: payments.runId })
      .from(payments)
      .where(eq(payments.id, line));
    if (!runId) throw new Error("the line has no run");
    const readers = async () =>
      (
        (await (
          await readRun(
            jsonRequest(`/api/orgs/${orgId}/payroll-runs/${runId}`, "GET", owner.cookie),
            params({ id: orgId, rid: runId }),
          )
        ).json()) as { run: { readers: unknown[] } }
      ).run.readers;
    expect(await readers()).toEqual([
      { grantId: created.grant.id, holder: "Daniel Osei", lines: 1 },
    ]);
    await revoke(
      jsonRequest(`/api/orgs/${orgId}/grants/${created.grant.id}/revoke`, "POST", owner.cookie),
      params({ id: orgId, gid: created.grant.id }),
    );
    expect(await readers()).toEqual([]);
  });

  it("AC-10.4 AC-10.5 revoking deletes the grant's records in the same transaction and logs it; a recipient's own payslips are not revoked here", async () => {
    const { owner, orgId, payment, person } = await setUp();
    await ownRecords(owner, orgId, [[payment, "payment"]]);
    const created = (await (await grant(owner.cookie, orgId, {})).json()) as {
      grant: GrantView;
      invite: { url: string };
    };
    const accountant = await createKeyUser(test);
    await registerKey(accountant);
    await acceptAs(accountant.cookie, tokenOf(created.invite.url));
    const [ownerItem] = await test.db
      .select()
      .from(disclosures)
      .where(and(eq(disclosures.orgId, orgId), eq(disclosures.subject, payment)));
    if (!ownerItem) throw new Error("the owner's record is missing");
    await test.db.insert(disclosures).values({
      orgId,
      grantId: created.grant.id,
      viewerUserId: accountant.userId,
      kind: "payment",
      subject: payment,
      ciphertext: Buffer.alloc(96, 9),
      manifestId: ownerItem.manifestId,
    });
    const revoked = await revoke(
      jsonRequest(`/api/orgs/${orgId}/grants/${created.grant.id}/revoke`, "POST", owner.cookie),
      params({ id: orgId, gid: created.grant.id }),
    );
    expect(revoked.status).toBe(200);
    expect(((await revoked.json()) as { grant: GrantView }).grant.status).toBe("revoked");
    expect(
      await test.db.select().from(disclosures).where(eq(disclosures.grantId, created.grant.id)),
    ).toEqual([]);
    // The owner's own record stays.
    expect(
      await test.db.select().from(disclosures).where(eq(disclosures.id, ownerItem.id)),
    ).toHaveLength(1);
    const [event] = await test.db
      .select()
      .from(accessLog)
      .where(and(eq(accessLog.orgId, orgId), eq(accessLog.action, "grant_revoked")));
    expect(event).toMatchObject({ subjectId: created.grant.id, metadata: { deleted: 1 } });
    expect(
      await errorOf(
        await revoke(
          jsonRequest(`/api/orgs/${orgId}/grants/${created.grant.id}/revoke`, "POST", owner.cookie),
          params({ id: orgId, gid: created.grant.id }),
        ),
      ),
    ).toMatchObject({ code: "grant_status" });
    // A recipient's own payslips follow their recipient record.
    const token = createHash("sha256").update(randomUUID()).digest("hex");
    await test.db.insert(invites).values({
      token,
      orgId,
      role: "accountant",
      createdBy: owner.userId,
      expiresAt: new Date(Date.now() + 3600_000),
    });
    const [payslips] = await test.db
      .insert(grants)
      .values({
        orgId,
        viewerUserId: person.userId,
        inviteToken: token,
        scope: "own_payslips",
        status: "active",
        createdBy: owner.userId,
      })
      .returning({ id: grants.id });
    if (!payslips) throw new Error("grant not created");
    expect(
      await errorOf(
        await revoke(
          jsonRequest(`/api/orgs/${orgId}/grants/${payslips.id}/revoke`, "POST", owner.cookie),
          params({ id: orgId, gid: payslips.id }),
        ),
      ),
    ).toMatchObject({ code: "grant_automatic" });
  });

  it("renews a pending grant's invite link, and not once the holder accepted", async () => {
    const { owner, orgId } = await setUp();
    const created = (await (await grant(owner.cookie, orgId, {})).json()) as {
      grant: GrantView;
      invite: { url: string };
    };
    const renewed = await renew(
      jsonRequest(`/api/orgs/${orgId}/grants/${created.grant.id}/invite`, "POST", owner.cookie),
      params({ id: orgId, gid: created.grant.id }),
    );
    expect(renewed.status).toBe(200);
    const { invite } = (await renewed.json()) as { invite: { url: string } };
    const accountant = await createKeyUser(test);
    // The first link stopped working.
    expect(
      await errorOf(await acceptAs(accountant.cookie, tokenOf(created.invite.url))),
    ).toMatchObject({ code: "invite_not_found" });
    expect((await acceptAs(accountant.cookie, tokenOf(invite.url))).status).toBe(200);
    expect(
      await errorOf(
        await renew(
          jsonRequest(`/api/orgs/${orgId}/grants/${created.grant.id}/invite`, "POST", owner.cookie),
          params({ id: orgId, gid: created.grant.id }),
        ),
      ),
    ).toMatchObject({ code: "grant_invite_accepted" });
  });

  it("AC-14.1 gives the owner the access log with labels from its subjects, metadata only, never an amount", async () => {
    const { owner, orgId, payment } = await setUp();
    await ownRecords(owner, orgId, [[payment, "payment"]]);
    await grant(owner.cookie, orgId, {
      scope: "period",
      periodFrom: "2026-07-01",
      periodTo: "2026-09-30",
    });
    const response = await readLog(
      jsonRequest(`/api/orgs/${orgId}/access-log`, "GET", owner.cookie),
      params({ id: orgId }),
    );
    expect(response.status).toBe(200);
    const { events } = (await response.json()) as {
      events: {
        action: string;
        actor: { userId: string } | null;
        subject: { type: string; label: string | null };
        metadata: Record<string, unknown>;
      }[];
    };
    expect(events.map((event) => event.action)).toEqual([
      "grant_created",
      "disclosure_batch_created",
    ]);
    expect(events[0]).toMatchObject({
      actor: { userId: owner.userId },
      subject: { type: "grant", label: "Daniel Osei" },
      metadata: { scope: "period", periodFrom: "2026-07-01", periodTo: "2026-09-30" },
    });
    expect(JSON.stringify(events)).not.toContain("7777000000");
    // The owner only.
    const stranger = await createKeyUser(test);
    expect(
      (
        await readLog(
          jsonRequest(`/api/orgs/${orgId}/access-log`, "GET", stranger.cookie),
          params({ id: orgId }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await readLog(
          jsonRequest(`/api/orgs/${orgId}/access-log?days=0`, "GET", owner.cookie),
          params({ id: orgId }),
        )
      ).status,
    ).toBe(400);
  });
});
