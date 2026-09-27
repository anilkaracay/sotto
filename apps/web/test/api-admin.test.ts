// Admin review (D-09, 08 section 3): GET /api/admin/orgs and the approve, reject and suspend
// decisions, plus the money gate that follows the org status (F-02). Issuing and closing the
// attestation after a decision is the worker's sas-issue job, tested against localnet SAS in
// apps/worker/test/sas-issue-localnet.test.ts.
import { admins, memberships, orgs } from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as approve } from "../app/api/admin/orgs/[id]/approve/route.ts";
import { POST as reject } from "../app/api/admin/orgs/[id]/reject/route.ts";
import { POST as suspend } from "../app/api/admin/orgs/[id]/suspend/route.ts";
import { GET as listOrgs } from "../app/api/admin/orgs/route.ts";
import { ApiError } from "../lib/server/errors.ts";
import { ADMIN_LIST_LIMIT, requireMoneyAccess } from "../lib/server/orgs.ts";
import { readSessionToken } from "../lib/server/session.ts";
import {
  APP_ORIGIN,
  apiRequest,
  createOrg,
  createUserWithSession,
  SESSION_SECRET,
  setUpApiTest,
  tearDownApiTest,
} from "./helpers/api.ts";

type User = { userId: string; wallet: string; cookie: string; token: string };

let test: TestDatabase;
let admin: User;
let ip = 0;

beforeAll(async () => {
  test = await setUpApiTest();
  admin = await createUserWithSession(test);
  await test.db.insert(admins).values({ wallet: admin.wallet });
});

afterAll(async () => {
  await tearDownApiTest(test);
});

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

const decisions = { approve, reject, suspend };

function decide(action: keyof typeof decisions, id: string, cookie: string | null = admin.cookie) {
  ip += 1;
  const request = apiRequest(`/api/admin/orgs/${id}/${action}`, {
    method: "POST",
    headers: {
      origin: APP_ORIGIN,
      "x-forwarded-for": `203.0.${Math.floor(ip / 250)}.${ip % 250}`,
      ...(cookie ? { cookie } : {}),
    },
  });
  return decisions[action](request, { params: Promise.resolve({ id }) });
}

function list(query = "", cookie: string | null = admin.cookie) {
  return listOrgs(apiRequest(`/api/admin/orgs${query}`, { headers: cookie ? { cookie } : {} }));
}

async function errorOf(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string; message: string } };
  return `${response.status} ${body.error.code}: ${body.error.message}`;
}

async function orgWithOwner(): Promise<{ orgId: string; owner: User }> {
  const owner = await createUserWithSession(test);
  return { orgId: await createOrg(test, owner.userId), owner };
}

async function statusOf(orgId: string) {
  const [row] = await test.db
    .select({ status: orgs.status, reviewedBy: orgs.reviewedBy, reviewedAt: orgs.reviewedAt })
    .from(orgs)
    .where(eq(orgs.id, orgId));
  return row;
}

describe("admin access", () => {
  it("is for the wallets in the admins table only; ADMIN_WALLETS is not consulted", async () => {
    const { orgId, owner } = await orgWithOwner();
    vi.stubEnv("ADMIN_WALLETS", owner.wallet);
    try {
      expect(await errorOf(await list("", owner.cookie))).toBe(
        "403 forbidden: You do not have access to this resource",
      );
      expect(await errorOf(await decide("approve", orgId, owner.cookie))).toBe(
        "403 forbidden: You do not have access to this resource",
      );
    } finally {
      vi.stubEnv("ADMIN_WALLETS", "");
    }
    expect((await list("", null)).status).toBe(401);
    expect((await decide("approve", orgId, null)).status).toBe(401);
    expect((await statusOf(orgId))?.status).toBe("pending_review");
  });
});

describe("admin review", () => {
  it("AC-02.2 keeps a new org in review, listed for the admins, until one approves it", async () => {
    const { orgId, owner } = await orgWithOwner();
    const response = await list("?status=pending_review");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { orgs: { id: string }[]; truncated: boolean };
    expect(body.truncated).toBe(false);
    expect(body.orgs.find((org) => org.id === orgId)).toMatchObject({
      status: "pending_review",
      ownerWallet: owner.wallet,
      legalName: "Northwind Labs Ltd",
      reviewedBy: null,
      attestationAddress: null,
    });
    const active = (await (await list("?status=active")).json()) as { orgs: { id: string }[] };
    expect(active.orgs.some((org) => org.id === orgId)).toBe(false);
    expect(await errorOf(await list("?status=approved"))).toBe(
      "400 invalid_request: status must be pending_review, active or suspended",
    );
    expect(ADMIN_LIST_LIMIT).toBe(200);
  });

  it("AC-02.3 approval makes the org active and records the reviewer; the worker issues the attestation", async () => {
    const { orgId } = await orgWithOwner();
    const response = await decide("approve", orgId);
    expect(response.status).toBe(200);
    const { org } = (await response.json()) as { org: Record<string, unknown> };
    expect(org).toMatchObject({ id: orgId, status: "active", reviewedBy: admin.wallet });
    // The attestation address is stored by the worker once the attestation exists onchain.
    expect(org.attestationAddress).toBeNull();
    const row = await statusOf(orgId);
    expect(row).toMatchObject({ status: "active", reviewedBy: admin.wallet });
    expect(Date.now() - (row?.reviewedAt?.getTime() ?? 0)).toBeLessThan(60_000);

    expect(await errorOf(await decide("approve", orgId))).toBe(
      "409 org_status_conflict: Only in review organizations can be approved; this one is active",
    );
    expect(await errorOf(await decide("reject", orgId))).toBe(
      "409 org_status_conflict: Only in review organizations can be rejected; this one is active",
    );
  });

  it("AC-02.4 revoking verification suspends an active org, once", async () => {
    const { orgId } = await orgWithOwner();
    expect((await decide("approve", orgId)).status).toBe(200);
    const response = await decide("suspend", orgId);
    expect(response.status).toBe(200);
    expect(((await response.json()) as { org: unknown }).org).toMatchObject({
      status: "suspended",
      reviewedBy: admin.wallet,
    });
    expect(await errorOf(await decide("suspend", orgId))).toBe(
      "409 org_status_conflict: Only active organizations can be suspended; this one is suspended",
    );
    // No way back in the hackathon build: a suspended org is not approved again.
    expect(await errorOf(await decide("approve", orgId))).toBe(
      "409 org_status_conflict: Only in review organizations can be approved; this one is suspended",
    );
  });

  it("rejects an org in review by suspending it (Q-13 DEFAULT) and never suspends one in review", async () => {
    const { orgId } = await orgWithOwner();
    expect(await errorOf(await decide("suspend", orgId))).toBe(
      "409 org_status_conflict: Only active organizations can be suspended; this one is in review",
    );
    const response = await decide("reject", orgId);
    expect(response.status).toBe(200);
    expect(await statusOf(orgId)).toMatchObject({ status: "suspended", reviewedBy: admin.wallet });
  });

  it("answers 404 for an unknown or malformed org ID", async () => {
    expect(await errorOf(await decide("approve", "00000000-0000-4000-8000-000000000000"))).toBe(
      "404 org_not_found: Organization not found",
    );
    expect(await errorOf(await decide("suspend", "not-a-uuid"))).toBe(
      "404 org_not_found: Organization not found",
    );
  });
});

describe("money gate", () => {
  async function gate(user: User, orgId: string) {
    const session = await readSessionToken(user.token, test.db, SESSION_SECRET);
    try {
      return await requireMoneyAccess(test.db, session, orgId, ["owner"]);
    } catch (error) {
      if (error instanceof ApiError) return `${error.status} ${error.code}: ${error.message}`;
      throw error;
    }
  }

  it("AC-02.2 disables money features while the org is in review; AC-02.4 while it is suspended", async () => {
    const { orgId, owner } = await orgWithOwner();
    const outsider = await createUserWithSession(test);
    expect(await gate(owner, orgId)).toBe(
      "403 org_not_active: Money features open once Sotto verifies the organization",
    );
    expect((await decide("approve", orgId)).status).toBe(200);
    expect(await gate(owner, orgId)).toEqual({ roles: ["owner"] });
    // Non members learn nothing about the org status.
    expect(await gate(outsider, orgId)).toBe(
      "403 forbidden: You do not have access to this resource",
    );
    expect((await decide("suspend", orgId)).status).toBe(200);
    expect(await gate(owner, orgId)).toBe(
      "403 org_not_active: Money features are disabled while the organization is not verified",
    );
  });

  it("checks the role before the status", async () => {
    const { orgId } = await orgWithOwner();
    const recipient = await createUserWithSession(test);
    await test.db
      .insert(memberships)
      .values({ orgId, userId: recipient.userId, role: "recipient" });
    expect(await gate(recipient, orgId)).toBe(
      "403 forbidden: You do not have access to this resource",
    );
  });
});
