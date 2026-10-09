// POST /api/orgs, GET and PATCH /api/orgs/:id (F-02, 08 section 3). The configuration here is a
// local ledger's, where a Sotto admin reviews a new organization (D-09), as on every configuration
// but devnet's; the last block is devnet's, where it is verified at once (step 4.6, D-30).
import { memberships, orgPolicy, orgs } from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH } from "../app/api/orgs/[id]/route.ts";
import { POST as quickStart } from "../app/api/orgs/quick-start/route.ts";
import { POST } from "../app/api/orgs/route.ts";
import { GET as getMe } from "../app/api/me/route.ts";
import { decideOrg, requireMoneyAccess } from "../lib/server/orgs.ts";
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
  vi.stubEnv("NEXT_PUBLIC_CLUSTER", "localnet");
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
      verification: null,
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
    const other = await createUserWithSession(test);
    expect(await errorOf(await create(other.cookie, { ...FIELDS, asset: "eurc" }))).toBe(
      "400 invalid_request: Invalid request: asset: Choose a currency",
    );
    // A local ledger without devUSD refuses it; one whose bootstrap made devUSD offers it, as devnet
    // does since step 4.3's live run.
    vi.stubEnv("NEXT_PUBLIC_CLUSTER", "localnet");
    try {
      expect(await errorOf(await create(other.cookie, { ...FIELDS, asset: "devusd" }))).toBe(
        "422 asset_unavailable: This currency is not available on this network",
      );
      vi.stubEnv("LOCALNET_DEVUSD_MINT", "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
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

    // Approved by an admin: the decision carries the admin's wallet (decideOrg).
    await test.db
      .update(orgs)
      .set({ status: "active", reviewedBy: accountant.wallet, reviewedAt: new Date() })
      .where(eq(orgs.id, orgId));
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

describe("POST /api/orgs on devnet (step 4.6, D-30)", () => {
  it.each([
    ["named", "devnet"],
    ["not named, which means devnet", ""],
  ])(
    "AC-02.3 verifies a new org at once, with no review, where the cluster is %s",
    async (_case, cluster) => {
      vi.stubEnv("NEXT_PUBLIC_CLUSTER", cluster);
      const user = await createUserWithSession(test);
      const response = await create(user.cookie, FIELDS);
      expect(response.status).toBe(201);
      const { org } = (await response.json()) as {
        org: { id: string; reviewedAt: string | null } & Record<string, unknown>;
      };
      expect(org).toMatchObject({
        ...FIELDS,
        status: "active",
        attestationAddress: null,
        verification: "automatic",
      });
      expect(org.reviewedAt).not.toBeNull();

      // No admin decided: the worker's sas-issue job reads this as the automatic level.
      const [row] = await test.db.select().from(orgs).where(eq(orgs.id, org.id));
      expect(row).toMatchObject({ status: "active", reviewedBy: null, attestationAddress: null });
      expect(row?.reviewedAt).toBeInstanceOf(Date);
      expect(
        await test.db
          .select({ userId: memberships.userId, role: memberships.role })
          .from(memberships)
          .where(eq(memberships.orgId, org.id)),
      ).toEqual([{ userId: user.userId, role: "owner" }]);

      // Money features are on at once.
      const session = { id: "s", userId: user.userId, wallet: user.wallet };
      await expect(requireMoneyAccess(test.db, session, org.id, ["owner"])).resolves.toBeDefined();
      const me = await getMe(apiRequest("/api/me", { headers: { cookie: user.cookie } }));
      expect(((await me.json()) as { memberships: unknown[] }).memberships).toEqual([
        { orgId: org.id, orgName: "Northwind Labs Ltd", orgStatus: "active", role: "owner" },
      ]);
    },
  );

  it("leaves its details to its owner, whom nobody reviewed, and still lets an admin suspend it", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLUSTER", "devnet");
    const owner = await createUserWithSession(test);
    const orgId = await createdOrg(owner);
    // D-33: no admin vouched for these details, so they are not locked.
    expect((await patch(owner.cookie, orgId, { legalName: "Another Name Ltd" })).status).toBe(200);
    expect((await patch(owner.cookie, orgId, { displayName: "Northwind" })).status).toBe(200);

    // AC-02.4 holds for it as for a reviewed org: the decision now carries the admin's wallet.
    const admin = await createUserWithSession(test);
    const suspended = await decideOrg(test.db, orgId, "suspend", admin.wallet);
    expect(suspended).toMatchObject({
      status: "suspended",
      reviewedBy: admin.wallet,
      verification: "review",
    });
    const session = { id: "s", userId: owner.userId, wallet: owner.wallet };
    await expect(requireMoneyAccess(test.db, session, orgId, ["owner"])).rejects.toMatchObject({
      code: "org_not_active",
    });
  });

  it("AC-02.2 keeps the review on a configuration that is not devnet's", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLUSTER", "localnet");
    const user = await createUserWithSession(test);
    const response = await create(user.cookie, FIELDS);
    const { org } = (await response.json()) as { org: { id: string } & Record<string, unknown> };
    expect(org).toMatchObject({ status: "pending_review", reviewedAt: null, verification: null });
    const session = { id: "s", userId: user.userId, wallet: user.wallet };
    await expect(requireMoneyAccess(test.db, session, org.id, ["owner"])).rejects.toMatchObject({
      code: "org_not_active",
    });
  });
});

describe("POST /api/orgs/quick-start (step 4.6, D-33)", () => {
  const start = (cookie: string | null) =>
    quickStart(
      apiRequest("/api/orgs/quick-start", {
        method: "POST",
        body: "{}",
        headers: writeHeaders(cookie),
      }),
    );

  it('AC-02.1 on devnet makes "My company" for a wallet with no organization, verified at once, with no form', async () => {
    vi.stubEnv("NEXT_PUBLIC_CLUSTER", "devnet");
    const user = await createUserWithSession(test);
    const response = await start(user.cookie);
    expect(response.status).toBe(200);
    const { org } = (await response.json()) as { org: Record<string, unknown> & { id: string } };
    expect(org).toMatchObject({
      displayName: "My company",
      legalName: "My company",
      country: null,
      registrationNo: null,
      website: null,
      contactEmail: null,
      status: "active",
      // The devnet test dollar, which the faucet gives.
      asset: "devusd",
      attestationAddress: null,
      verification: "automatic",
    });
    const [row] = await test.db.select().from(orgs).where(eq(orgs.id, org.id));
    expect(row).toMatchObject({ ownerUserId: user.userId, status: "active", reviewedBy: null });
    expect(row?.reviewedAt).toBeInstanceOf(Date);
    expect(
      await test.db
        .select({ userId: memberships.userId, role: memberships.role })
        .from(memberships)
        .where(eq(memberships.orgId, org.id)),
    ).toEqual([{ userId: user.userId, role: "owner" }]);
    expect(await test.db.select().from(orgPolicy).where(eq(orgPolicy.orgId, org.id))).toHaveLength(
      1,
    );
    const session = { id: "s", userId: user.userId, wallet: user.wallet };
    await expect(requireMoneyAccess(test.db, session, org.id, ["owner"])).resolves.toBeDefined();

    // Asked again, also twice at once, the wallet gets the same company back.
    const again = await Promise.all([start(user.cookie), start(user.cookie)]);
    for (const next of again) {
      expect(next.status).toBe(200);
      expect(((await next.json()) as { org: { id: string } }).org.id).toBe(org.id);
    }
    expect(await test.db.select().from(orgs).where(eq(orgs.ownerUserId, user.userId))).toHaveLength(
      1,
    );
  });

  it("is refused for a member of another organization and without a session", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLUSTER", "devnet");
    const owner = await createUserWithSession(test);
    const orgId = await createdOrg(owner);
    const invited = await createUserWithSession(test);
    await test.db.insert(memberships).values({ orgId, userId: invited.userId, role: "recipient" });
    expect(await errorOf(await start(invited.cookie))).toBe(
      "409 quick_start_not_new: Quick start is for a wallet that belongs to no organization yet",
    );
    expect(await test.db.select().from(orgs).where(eq(orgs.ownerUserId, invited.userId))).toEqual(
      [],
    );
    expect((await start(null)).status).toBe(401);
  });

  it("AC-02.2 does not exist on a configuration that is not devnet's: the form and the review stay", async () => {
    const user = await createUserWithSession(test);
    for (const cluster of ["localnet", "mainnet"]) {
      vi.stubEnv("NEXT_PUBLIC_CLUSTER", cluster);
      expect(await errorOf(await start(user.cookie))).toBe(
        "403 quick_start_devnet_only: Quick start runs on devnet only",
      );
    }
    expect(await test.db.select().from(orgs).where(eq(orgs.ownerUserId, user.userId))).toEqual([]);
    // The form's path is as it was.
    vi.stubEnv("NEXT_PUBLIC_CLUSTER", "localnet");
    const created = await create(user.cookie, FIELDS);
    expect(((await created.json()) as { org: { status: string } }).org.status).toBe(
      "pending_review",
    );
  });
});

describe("PATCH /api/orgs/:id for a company verified automatically (step 4.6, D-33)", () => {
  it("lets its owner change the details at any time, and a new name or country means a new attestation", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLUSTER", "devnet");
    const owner = await createUserWithSession(test);
    const made = await quickStart(
      apiRequest("/api/orgs/quick-start", {
        method: "POST",
        body: "{}",
        headers: writeHeaders(owner.cookie),
      }),
    );
    const orgId = ((await made.json()) as { org: { id: string } }).org.id;
    const ATTESTATION = "4KX4P7he62x5x8X35vubNNhJRhV4vJXPGNsc8skPyKFT";
    const attest = () =>
      test.db.update(orgs).set({ attestationAddress: ATTESTATION }).where(eq(orgs.id, orgId));
    const stored = async () =>
      (await test.db.select().from(orgs).where(eq(orgs.id, orgId)))[0]?.attestationAddress;

    // The worker issued its attestation; a detail that is not in it changes nothing onchain.
    await attest();
    const details = await patch(owner.cookie, orgId, {
      registrationNo: "HRB 7",
      website: "https://acme.example",
      contactEmail: "ops@acme.example",
      displayName: "Acme",
    });
    expect(details.status).toBe(200);
    expect(await stored()).toBe(ATTESTATION);

    // The legal name and the country are in the attestation: it is to be issued again.
    const renamed = await patch(owner.cookie, orgId, { legalName: "Acme GmbH", country: "DE" });
    expect(((await renamed.json()) as { org: unknown }).org).toMatchObject({
      legalName: "Acme GmbH",
      country: "DE",
      status: "active",
      verification: "automatic",
      attestationAddress: null,
    });
    expect(await stored()).toBeNull();
    // The same values again leave the new attestation alone.
    await attest();
    await patch(owner.cookie, orgId, { legalName: "Acme GmbH", country: "DE" });
    expect(await stored()).toBe(ATTESTATION);
    // A detail is cleared with null; the legal name cannot be.
    const cleared = await patch(owner.cookie, orgId, { country: null, website: null });
    expect(((await cleared.json()) as { org: unknown }).org).toMatchObject({
      country: null,
      website: null,
      attestationAddress: null,
    });
    expect((await patch(owner.cookie, orgId, { legalName: null })).status).toBe(400);
    expect((await patch(owner.cookie, orgId, { legalName: "  " })).status).toBe(400);
  });

  it("keeps the details an admin reviewed locked, on devnet too", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLUSTER", "devnet");
    const owner = await createUserWithSession(test);
    const orgId = await createdOrg(owner);
    const admin = await createUserWithSession(test);
    // Reviewed by an admin (as Northwind was): the decision carries the admin's wallet.
    await test.db
      .update(orgs)
      .set({ reviewedBy: admin.wallet, reviewedAt: new Date() })
      .where(eq(orgs.id, orgId));
    expect(await errorOf(await patch(owner.cookie, orgId, { legalName: "Another Name Ltd" }))).toBe(
      "409 org_details_locked: The legal name, country, registration number and website can change only while the organization is in review",
    );
    expect(
      (await patch(owner.cookie, orgId, { contactEmail: "new@northwind.example" })).status,
    ).toBe(200);
  });
});
