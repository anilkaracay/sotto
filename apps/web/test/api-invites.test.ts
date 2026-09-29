// Recipient invites (AC-07.3, 07 section 7, 08 section 3; step 1.8): the owner creates a link for one
// recipient (the database keeps only the token's SHA-256), anyone with the link can read what it is,
// and only the recipient's wallet can accept it: the membership, the link to the user and the
// own_payslips grant, which activates with the viewing key (07 section 5).
import { createHash } from "node:crypto";
import { grants, invites, memberships, orgs, recipients } from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { viewKeyRegistrationMessage } from "@sotto/sdk/keys/public";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as accept } from "../app/api/invites/[token]/accept/route.ts";
import { GET as readInvite } from "../app/api/invites/[token]/route.ts";
import { POST as createInvite } from "../app/api/orgs/[id]/invites/route.ts";
import { POST as addRecipient } from "../app/api/orgs/[id]/recipients/route.ts";
import { POST as registerViewerKey } from "../app/api/viewer-keys/route.ts";
import {
  APP_ORIGIN,
  createKeyUser,
  createOrgWithStatus,
  errorOf,
  jsonRequest,
  setUpApiTest,
  tearDownApiTest,
} from "./helpers/api.ts";

vi.mock("../lib/server/chain.ts", () => ({
  serverRpc: () => ({
    getAccountInfo: () => ({ send: async () => ({ context: { slot: 1n }, value: null }) }),
  }),
}));

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

/** An active org, a recipient in it for a user with a real wallet, and that user. */
async function setUp() {
  const owner = await createKeyUser(test);
  const orgId = await createOrgWithStatus(test, owner.userId, "active");
  const person = await createKeyUser(test);
  const created = await addRecipient(
    jsonRequest(`/api/orgs/${orgId}/recipients`, "POST", owner.cookie, {
      displayName: "Maya Chen",
      roleTitle: "Design lead",
      wallet: person.wallet,
    }),
    { params: Promise.resolve({ id: orgId }) },
  );
  const recipientId = ((await created.json()) as { recipient: { id: string } }).recipient.id;
  return { owner, orgId, person, recipientId };
}

async function invite(cookie: string, orgId: string, recipientId: string) {
  const response = await createInvite(
    jsonRequest(`/api/orgs/${orgId}/invites`, "POST", cookie, { role: "recipient", recipientId }),
    { params: Promise.resolve({ id: orgId }) },
  );
  return response;
}

const tokenOf = (url: string) => url.split("/app/invite/")[1] ?? "";
const view = (token: string, cookie: string | null = null) =>
  readInvite(jsonRequest(`/api/invites/${token}`, "GET", cookie), {
    params: Promise.resolve({ token }),
  });
const acceptAs = (cookie: string | null, token: string) =>
  accept(jsonRequest(`/api/invites/${token}/accept`, "POST", cookie), {
    params: Promise.resolve({ token }),
  });

describe("recipient invites", () => {
  it("AC-07.3 lets the recipient's wallet accept the link: membership, link and own_payslips grant; the recipient's details only for that wallet", async () => {
    const { owner, orgId, person, recipientId } = await setUp();
    const created = await invite(owner.cookie, orgId, recipientId);
    expect(created.status).toBe(201);
    const { invite: link } = (await created.json()) as {
      invite: { url: string; expiresAt: string };
    };
    expect(link.url).toMatch(new RegExp(`^${APP_ORIGIN}/app/invite/[A-Za-z0-9_-]{43}$`));
    const token = tokenOf(link.url);
    // Only the SHA-256 of the token is stored.
    const [stored] = await test.db
      .select()
      .from(invites)
      .where(eq(invites.recipientId, recipientId));
    expect(stored?.token).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(new Date(link.expiresAt).getTime() - Date.now()).toBeGreaterThan(6.9 * 24 * 3600 * 1000);

    // Before sign in: the organization and the status only (founder, step 1.8.1).
    const before = (await (await view(token)).json()) as { invite: Record<string, unknown> };
    expect(before.invite).toEqual({
      org: { id: orgId, displayName: "Northwind Labs" },
      status: "open",
      details: null,
      expectedWallet: null,
      acceptedByYou: false,
    });
    expect(JSON.stringify(before)).not.toContain("Maya Chen");
    expect(JSON.stringify(before)).not.toContain(person.wallet);
    // Another signed in wallet: only the wallet the invite is for.
    const stranger = await createKeyUser(test);
    const theirs = (await (await view(token, stranger.cookie)).json()) as {
      invite: Record<string, unknown>;
    };
    expect(theirs.invite).toMatchObject({ details: null, expectedWallet: person.wallet });
    expect(JSON.stringify(theirs)).not.toContain("Maya Chen");
    // The invited wallet: the recipient's name, role and wallet, and the link's expiry.
    const mine = (await (await view(token, person.cookie)).json()) as {
      invite: Record<string, unknown>;
    };
    expect(mine.invite).toMatchObject({
      status: "open",
      expectedWallet: null,
      details: {
        role: "recipient",
        recipient: { displayName: "Maya Chen", roleTitle: "Design lead", wallet: person.wallet },
        expiresAt: link.expiresAt,
      },
    });

    const accepted = await acceptAs(person.cookie, token);
    expect(accepted.status).toBe(200);
    expect(((await accepted.json()) as { accepted: unknown }).accepted).toEqual({
      orgId,
      role: "recipient",
      grant: { status: "pending_viewer_key" },
    });
    const [membership] = await test.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, person.userId)));
    expect(membership?.role).toBe("recipient");
    const [linked] = await test.db.select().from(recipients).where(eq(recipients.id, recipientId));
    expect(linked?.userId).toBe(person.userId);
    const [grant] = await test.db
      .select()
      .from(grants)
      .where(eq(grants.viewerUserId, person.userId));
    expect(grant).toMatchObject({ orgId, scope: "own_payslips", status: "pending_viewer_key" });
    const after = (await (await view(token, person.cookie)).json()) as {
      invite: Record<string, unknown>;
    };
    expect(after.invite).toMatchObject({ status: "accepted", acceptedByYou: true });
    expect(await errorOf(await acceptAs(person.cookie, token))).toMatchObject({
      code: "invite_accepted",
    });

    // Registering the viewing key activates the grant (07 section 5).
    const publicKey = crypto.getRandomValues(new Uint8Array(32));
    const registered = await registerViewerKey(
      jsonRequest("/api/viewer-keys", "POST", person.cookie, {
        publicKey: Buffer.from(publicKey).toString("base64"),
        signature: Buffer.from(await person.sign(viewKeyRegistrationMessage(publicKey))).toString(
          "base64",
        ),
      }),
    );
    expect(registered.status).toBe(201);
    const [active] = await test.db
      .select()
      .from(grants)
      .where(eq(grants.viewerUserId, person.userId));
    expect(active?.status).toBe("active");
  });

  it("refuses another wallet, an expired or replaced link, and an organization that is not active", async () => {
    const { owner, orgId, person, recipientId } = await setUp();
    const first = tokenOf(
      (
        (await (await invite(owner.cookie, orgId, recipientId)).json()) as {
          invite: { url: string };
        }
      ).invite.url,
    );
    const second = tokenOf(
      (
        (await (await invite(owner.cookie, orgId, recipientId)).json()) as {
          invite: { url: string };
        }
      ).invite.url,
    );
    // A new link replaces the open one.
    expect(await errorOf(await view(first))).toMatchObject({ code: "invite_not_found" });
    const stranger = await createKeyUser(test);
    const wrong = await acceptAs(stranger.cookie, second);
    expect(wrong.status).toBe(403);
    expect(await errorOf(wrong)).toMatchObject({
      code: "invite_wrong_wallet",
      message: `This invite is for the wallet ${person.wallet}. Sign in with that wallet.`,
    });
    expect((await acceptAs(null, second)).status).toBe(401);

    await test.db
      .update(invites)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invites.recipientId, recipientId));
    expect(
      ((await (await view(second)).json()) as { invite: { status: string } }).invite.status,
    ).toBe("expired");
    expect(await errorOf(await acceptAs(person.cookie, second))).toMatchObject({
      code: "invite_expired",
    });

    const third = tokenOf(
      (
        (await (await invite(owner.cookie, orgId, recipientId)).json()) as {
          invite: { url: string };
        }
      ).invite.url,
    );
    await test.db.update(orgs).set({ status: "suspended" }).where(eq(orgs.id, orgId));
    expect(
      ((await (await view(third)).json()) as { invite: { status: string } }).invite.status,
    ).toBe("unavailable");
    expect(await errorOf(await acceptAs(person.cookie, third))).toMatchObject({
      code: "invite_unavailable",
    });
    for (const token of ["short", "x".repeat(43)]) {
      expect(await errorOf(await view(token))).toMatchObject({ code: "invite_not_found" });
    }
  });

  it("Q-16 writes no invite link token to the request log while the link is read and accepted", async () => {
    const { owner, orgId, person, recipientId } = await setUp();
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((line: string) => lines.push(line));
    vi.spyOn(console, "error").mockImplementation((line: string) => lines.push(line));
    const created = await invite(owner.cookie, orgId, recipientId);
    const token = tokenOf(((await created.json()) as { invite: { url: string } }).invite.url);
    expect(token).toHaveLength(43);
    expect((await view(token)).status).toBe(200);
    expect((await view(token, person.cookie)).status).toBe(200);
    expect((await acceptAs(person.cookie, token)).status).toBe(200);
    // A wrong token is logged the same way, never in the clear either.
    expect((await acceptAs(person.cookie, `${token.slice(0, 40)}xyz`)).status).toBe(404);
    const requests = lines.filter((line) => line.includes('"event":"api_request"'));
    expect(requests.length).toBeGreaterThanOrEqual(5);
    for (const line of lines) {
      expect(line).not.toContain(token);
      expect(line).not.toContain(token.slice(0, 40));
    }
    expect(requests.some((line) => line.includes('"path":"/api/invites/:token"'))).toBe(true);
    expect(requests.some((line) => line.includes('"path":"/api/invites/:token/accept"'))).toBe(
      true,
    );
  });

  it("AC-02.2 lets only the owner of an active org create invite links, and never for a joined recipient", async () => {
    const { owner, orgId, person, recipientId } = await setUp();
    const stranger = await createKeyUser(test);
    expect(await errorOf(await invite(stranger.cookie, orgId, recipientId))).toMatchObject({
      code: "forbidden",
    });
    const token = tokenOf(
      (
        (await (await invite(owner.cookie, orgId, recipientId)).json()) as {
          invite: { url: string };
        }
      ).invite.url,
    );
    await acceptAs(person.cookie, token);
    expect(await errorOf(await invite(person.cookie, orgId, recipientId))).toMatchObject({
      code: "forbidden",
    });
    expect(await errorOf(await invite(owner.cookie, orgId, recipientId))).toMatchObject({
      code: "recipient_joined",
    });
    for (const status of ["pending_review", "suspended"] as const) {
      const other = await createKeyUser(test);
      const otherOrg = await createOrgWithStatus(test, other.userId, status);
      const response = await invite(other.cookie, otherOrg, recipientId);
      expect(response.status).toBe(403);
      expect((await errorOf(response)).code).toBe("org_not_active");
    }
    expect(
      (
        await createInvite(
          jsonRequest(`/api/orgs/${orgId}/invites`, "POST", owner.cookie, {
            role: "accountant",
            recipientId,
          }),
          { params: Promise.resolve({ id: orgId }) },
        )
      ).status,
    ).toBe(400);
    const missing = await invite(owner.cookie, orgId, "7c2a9e41-1b2c-4f0e-8a77-3d5e6f708192");
    expect(await errorOf(missing)).toMatchObject({ code: "recipient_not_found" });
  });
});
