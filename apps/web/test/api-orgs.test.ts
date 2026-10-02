// POST /api/orgs, GET and PATCH /api/orgs/:id (F-02, 08 section 3).
import { memberships, orgPolicy, orgs } from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH } from "../app/api/orgs/[id]/route.ts";
import { POST } from "../app/api/orgs/route.ts";
import { GET as getMe } from "../app/api/me/route.ts";
import {
  APP_ORIGIN,
  apiRequest,
  createUserWithSession,
  setUpApiTest,
  tearDownApiTest,
} from "./helpers/api.ts";

const FIELDS = {
  legalName: "Northwind Labs Ltd",
  country: "TR",
  registrationNo: "0001",
  website: "https://northwind.example",
  contactEmail: "ops@northwind.example",
};

type User = { userId: string; wallet: string; cookie: string };

let test: TestDatabase;
let ip = 0;

beforeAll(async () => {
  test = await setUpApiTest();
});

afterAll(async () => {
  await tearDownApiTest(test);
});

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

// Each request gets its own client IP, so the per IP write limit never interferes.
function writeHeaders(cookie: string | null, extra: Record<string, string> = {}) {
  ip += 1;
  return {
    origin: APP_ORIGIN,
    "content-type": "application/json",
    "x-forwarded-for": `198.51.${Math.floor(ip / 250)}.${ip % 250}`,
    ...(cookie ? { cookie } : {}),
    ...extra,
  };
}

function create(cookie: string | null, body: unknown, extra: Record<string, string> = {}) {
  return POST(
    apiRequest("/api/orgs", {
      method: "POST",
      body: JSON.stringify(body),
      headers: writeHeaders(cookie, extra),
    }),
  );
}

function read(cookie: string | null, id: string) {
  return GET(apiRequest(`/api/orgs/${id}`, { headers: cookie ? { cookie } : {} }), {
    params: Promise.resolve({ id }),
  });
}

function patch(cookie: string, id: string, body: unknown) {
  return PATCH(
    apiRequest(`/api/orgs/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: writeHeaders(cookie),
    }),
    { params: Promise.resolve({ id }) },
  );
}

async function errorOf(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string; message: string } };
  return `${response.status} ${body.error.code}: ${body.error.message}`;
}

async function createdOrg(user: User, body: unknown = FIELDS): Promise<string> {
  const response = await create(user.cookie, body);
  expect(response.status).toBe(201);
  return ((await response.json()) as { org: { id: string } }).org.id;
}

describe("POST /api/orgs", () => {
  it("AC-02.1 creates an org in review with the KYB fields, and the creator becomes Owner", async () => {
    const user = await createUserWithSession(test);
    const response = await create(user.cookie, FIELDS);
    expect(response.status).toBe(201);
    const { org } = (await response.json()) as { org: Record<string, unknown> & { id: string } };
    expect(org).toMatchObject({
      ...FIELDS,
      displayName: "Northwind Labs Ltd",
      status: "pending_review",
      attestationAddress: null,
      reviewedAt: null,
    });

    const [row] = await test.db.select().from(orgs).where(eq(orgs.id, org.id));
    expect(row).toMatchObject({ ...FIELDS, ownerUserId: user.userId, status: "pending_review" });
    expect(
      await test.db
        .select({ userId: memberships.userId, role: memberships.role })
        .from(memberships)
        .where(eq(memberships.orgId, org.id)),
    ).toEqual([{ userId: user.userId, role: "owner" }]);
    expect(await test.db.select().from(orgPolicy).where(eq(orgPolicy.orgId, org.id))).toEqual([
      { orgId: org.id, paymentApprovalsRequired: 1, payrollApprovalsRequired: 1 },
    ]);

    const me = await getMe(apiRequest("/api/me", { headers: { cookie: user.cookie } }));
    expect(((await me.json()) as { memberships: unknown[] }).memberships).toEqual([
      { orgId: org.id, orgName: "Northwind Labs Ltd", orgStatus: "pending_review", role: "owner" },
    ]);
  });

  it("step 4.3: the asset is USDC unless the network's registry has the one chosen, and it never changes", async () => {
    const user = await createUserWithSession(test);
    const plain = await create(user.cookie, FIELDS);
    const { org } = (await plain.json()) as { org: { id: string; asset: string } };
    expect(org.asset).toBe("usdc");
    // Devnet has no devUSD until its mints and its sotto_proofs deployment exist.
    const other = await createUserWithSession(test);
    expect(await errorOf(await create(other.cookie, { ...FIELDS, asset: "devusd" }))).toBe(
      "422 asset_unavailable: This currency is not available on this network",
    );
    expect(await errorOf(await create(other.cookie, { ...FIELDS, asset: "eurc" }))).toBe(
      "400 invalid_request: Invalid request: asset: Choose a currency",
    );
    // A local ledger whose bootstrap made devUSD offers it.
    vi.stubEnv("NEXT_PUBLIC_CLUSTER", "localnet");
    vi.stubEnv("LOCALNET_DEVUSD_MINT", "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
    try {
      const devusd = await create(other.cookie, { ...FIELDS, asset: "devusd" });
      expect(devusd.status).toBe(201);
      const created = ((await devusd.json()) as { org: { id: string; asset: string } }).org;
      expect(created.asset).toBe("devusd");
      expect(await errorOf(await patch(other.cookie, created.id, { asset: "usdc" }))).toMatch(
        /^400 invalid_request: Invalid request: body: Unrecognized key: "asset"/,
      );
      const [row] = await test.db.select().from(orgs).where(eq(orgs.id, created.id));
      expect(row?.asset).toBe("devusd");
    } finally {
      vi.stubEnv("NEXT_PUBLIC_CLUSTER", "");
      vi.stubEnv("LOCALNET_DEVUSD_MINT", "");
    }
  });

  it("AC-02.1 trims the fields and takes an optional display name", async () => {
    const user = await createUserWithSession(test);
    const response = await create(user.cookie, {
      ...FIELDS,
      legalName: "  Northwind Labs Ltd ",
      displayName: " Northwind ",
    });
    expect(response.status).toBe(201);
    expect(((await response.json()) as { org: unknown }).org).toMatchObject({
      legalName: "Northwind Labs Ltd",
      displayName: "Northwind",
    });
  });

  it("AC-02.1 validates every KYB field and names the first invalid one, never its value", async () => {
    const user = await createUserWithSession(test);
    const cases: [unknown, string][] = [
      [{ ...FIELDS, legalName: " " }, "legalName: Enter the legal name as registered"],
      [{ ...FIELDS, legalName: "中".repeat(134) }, "legalName: Use a shorter legal name"],
      [{ ...FIELDS, country: "XX" }, "country: Choose a country"],
      [{ ...FIELDS, country: "tr" }, "country: Choose a country"],
      [{ ...FIELDS, registrationNo: "" }, "registrationNo: Enter the company registration number"],
      [
        { ...FIELDS, website: "northwind.example" },
        "website: Enter the website address, for example https://example.com",
      ],
      [
        { ...FIELDS, website: "ftp://northwind.example" },
        "website: Enter the website address, for example https://example.com",
      ],
      [{ ...FIELDS, contactEmail: "ops@" }, "contactEmail: Enter a valid email address"],
      // An org cannot approve itself or pick its owner.
      [{ ...FIELDS, status: "active" }, 'body: Unrecognized key: "status"'],
      [{ ...FIELDS, ownerUserId: user.userId }, 'body: Unrecognized key: "ownerUserId"'],
    ];
    for (const [body, message] of cases) {
      expect(await errorOf(await create(user.cookie, body))).toBe(
        `400 invalid_request: Invalid request: ${message}`,
      );
    }
    expect(await test.db.select().from(orgs).where(eq(orgs.ownerUserId, user.userId))).toEqual([]);
  });

  it("AC-02.1 allows one organization per owner wallet (the attestation nonce)", async () => {
    const user = await createUserWithSession(test);
    await createdOrg(user);
    expect(await errorOf(await create(user.cookie, { ...FIELDS, legalName: "Second Ltd" }))).toBe(
      "409 org_exists: This wallet already has an organization",
    );
    expect(await test.db.select().from(orgs).where(eq(orgs.ownerUserId, user.userId))).toHaveLength(
      1,
    );
  });

  it("AC-02.1 needs a session and a same origin request", async () => {
    const user = await createUserWithSession(test);
    expect(await errorOf(await create(null, FIELDS))).toBe(
      "401 unauthenticated: Sign in to continue",
    );
    expect(
      await errorOf(await create(user.cookie, FIELDS, { origin: "https://evil.example" })),
    ).toBe("403 forbidden_origin: Request origin not allowed");
  });
});

describe("GET /api/orgs/:id", () => {
  it("lets every active member read the org with their roles, and nobody else", async () => {
    const owner = await createUserWithSession(test);
    const accountant = await createUserWithSession(test);
    const outsider = await createUserWithSession(test);
    const orgId = await createdOrg(owner);
    await test.db
      .insert(memberships)
      .values({ orgId, userId: accountant.userId, role: "accountant" });

    const asOwner = await read(owner.cookie, orgId);
    expect(asOwner.status).toBe(200);
    expect(asOwner.headers.get("cache-control")).toBe("no-store");
    expect(await asOwner.json()).toMatchObject({
      org: { id: orgId, ...FIELDS, status: "pending_review" },
      roles: ["owner"],
    });
    expect(await (await read(accountant.cookie, orgId)).json()).toMatchObject({
      roles: ["accountant"],
    });
    expect(await errorOf(await read(outsider.cookie, orgId))).toBe(
      "403 forbidden: You do not have access to this resource",
    );
    expect((await read(owner.cookie, "not-a-uuid")).status).toBe(403);
    expect((await read(null, orgId)).status).toBe(401);
  });
});

describe("PATCH /api/orgs/:id", () => {
  it("lets the owner edit the org; the reviewed fields change only while it is in review", async () => {
    const owner = await createUserWithSession(test);
    const accountant = await createUserWithSession(test);
    const orgId = await createdOrg(owner);
    await test.db
      .insert(memberships)
      .values({ orgId, userId: accountant.userId, role: "accountant" });

    const edited = await patch(owner.cookie, orgId, {
      legalName: "Northwind Labs Limited",
      website: "https://northwind.example/about",
    });
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as { org: unknown }).org).toMatchObject({
      legalName: "Northwind Labs Limited",
      website: "https://northwind.example/about",
      status: "pending_review",
    });
    expect(await errorOf(await patch(accountant.cookie, orgId, { displayName: "X" }))).toBe(
      "403 forbidden: You do not have access to this resource",
    );
    expect(await errorOf(await patch(owner.cookie, orgId, {}))).toBe(
      "400 invalid_request: Invalid request: body: Send at least one field to change",
    );
    expect(await errorOf(await patch(owner.cookie, orgId, { status: "active" }))).toMatch(
      /^400 invalid_request: Invalid request: body: Unrecognized key: "status"/,
    );

    await test.db.update(orgs).set({ status: "active" }).where(eq(orgs.id, orgId));
    for (const field of [
      { legalName: "Other Ltd" },
      { country: "DE" },
      { registrationNo: "0002" },
      { website: "https://other.example" },
    ]) {
      expect(await errorOf(await patch(owner.cookie, orgId, field))).toBe(
        "409 org_details_locked: The legal name, country, registration number and website can change only while the organization is in review",
      );
    }
    const contact = await patch(owner.cookie, orgId, {
      displayName: "Northwind",
      contactEmail: "finance@northwind.example",
    });
    expect(contact.status).toBe(200);
    const [row] = await test.db.select().from(orgs).where(eq(orgs.id, orgId));
    expect(row).toMatchObject({
      legalName: "Northwind Labs Limited",
      country: "TR",
      displayName: "Northwind",
      contactEmail: "finance@northwind.example",
      status: "active",
    });
  });
});
