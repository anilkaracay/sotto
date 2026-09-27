// Sessions and row access against a test database: the forbidden access matrix for requireMembership
// (08 section 2) and the session lifetime rules (04 section 5).
import { memberships, sessions } from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiError } from "../lib/server/errors.ts";
import { requireMembership } from "../lib/server/membership.ts";
import {
  readSession,
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  sessionCookie,
  sessionIdFromToken,
  type Session,
} from "../lib/server/session.ts";
import {
  apiRequest,
  createOrg,
  createUserWithSession,
  SESSION_SECRET,
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

async function forbiddenCode(run: Promise<unknown>): Promise<string> {
  try {
    await run;
  } catch (error) {
    if (error instanceof ApiError) return `${error.status} ${error.code}`;
    throw error;
  }
  return "allowed";
}

describe("sessions", () => {
  it("store only the HMAC of the token and resolve the cookie to the user", async () => {
    const user = await createUserWithSession(test);
    const stored = await test.db.select({ id: sessions.id }).from(sessions);
    expect(stored.map((row) => row.id)).toContain(sessionIdFromToken(user.token, SESSION_SECRET));
    expect(stored.map((row) => row.id)).not.toContain(user.token);
    const session = await readSession(
      apiRequest("/api/x", { headers: { cookie: user.cookie } }),
      test.db,
      SESSION_SECRET,
    );
    expect(session).toEqual({
      id: sessionIdFromToken(user.token, SESSION_SECRET),
      userId: user.userId,
      wallet: user.wallet,
    });
  });

  it("are null for a missing, unknown, revoked, expired or idle session", async () => {
    const user = await createUserWithSession(test);
    const request = apiRequest("/api/x", { headers: { cookie: user.cookie } });
    expect(await readSession(apiRequest("/api/x"), test.db, SESSION_SECRET)).toBeNull();
    expect(
      await readSession(
        apiRequest("/api/x", { headers: { cookie: "sotto_session=unknown" } }),
        test.db,
        SESSION_SECRET,
      ),
    ).toBeNull();
    expect(await readSession(request, test.db, "another-secret-0123456789abcdefghij")).toBeNull();
    const id = sessionIdFromToken(user.token, SESSION_SECRET);
    const now = Date.now();
    expect(
      await readSession(request, test.db, SESSION_SECRET, new Date(now + SESSION_IDLE_MS + 60_000)),
    ).toBeNull();
    expect(
      await readSession(request, test.db, SESSION_SECRET, new Date(now + SESSION_ABSOLUTE_MS + 1)),
    ).toBeNull();
    await test.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, id));
    expect(await readSession(request, test.db, SESSION_SECRET)).toBeNull();
  });

  it("refresh last_seen_at when used after a while, which extends the idle window", async () => {
    const user = await createUserWithSession(test);
    const request = apiRequest("/api/x", { headers: { cookie: user.cookie } });
    const later = new Date(Date.now() + 6 * 60 * 1000);
    expect(await readSession(request, test.db, SESSION_SECRET, later)).not.toBeNull();
    const [row] = await test.db
      .select({ lastSeenAt: sessions.lastSeenAt })
      .from(sessions)
      .where(eq(sessions.id, sessionIdFromToken(user.token, SESSION_SECRET)));
    expect(row?.lastSeenAt.getTime()).toBe(later.getTime());
  });

  it("use an httpOnly, SameSite=Lax, Secure cookie", () => {
    const cookie = sessionCookie("tok", new Date("2026-10-04T00:00:00Z"));
    expect(cookie).toBe(
      "sotto_session=tok; Path=/; HttpOnly; SameSite=Lax; Expires=Sun, 04 Oct 2026 00:00:00 GMT; Secure",
    );
  });
});

describe("requireMembership (forbidden access)", () => {
  let owner: Session;
  let accountant: Session;
  let outsider: Session;
  let orgId: string;
  let otherOrgId: string;

  const session = async (): Promise<Session> => {
    const user = await createUserWithSession(test);
    return {
      id: sessionIdFromToken(user.token, SESSION_SECRET),
      userId: user.userId,
      wallet: user.wallet,
    };
  };

  beforeAll(async () => {
    owner = await session();
    accountant = await session();
    outsider = await session();
    orgId = await createOrg(test, owner.userId);
    otherOrgId = await createOrg(test, outsider.userId);
    await test.db
      .insert(memberships)
      .values({ orgId, userId: accountant.userId, role: "accountant" });
  });

  it("allows an active member in one of the roles", async () => {
    expect(await requireMembership(test.db, owner, orgId, ["owner"])).toEqual({ roles: ["owner"] });
    expect(await requireMembership(test.db, accountant, orgId, ["owner", "accountant"])).toEqual({
      roles: ["accountant"],
    });
  });

  it("refuses without a session (401)", async () => {
    expect(await forbiddenCode(requireMembership(test.db, null, orgId, ["owner"]))).toBe(
      "401 unauthenticated",
    );
  });

  it("refuses a member of another org, a wrong role, an unknown or malformed org (403)", async () => {
    expect(
      await forbiddenCode(
        requireMembership(test.db, outsider, orgId, [
          "owner",
          "accountant",
          "approver",
          "board",
          "recipient",
        ]),
      ),
    ).toBe("403 forbidden");
    expect(await forbiddenCode(requireMembership(test.db, owner, otherOrgId, ["owner"]))).toBe(
      "403 forbidden",
    );
    expect(await forbiddenCode(requireMembership(test.db, accountant, orgId, ["owner"]))).toBe(
      "403 forbidden",
    );
    expect(
      await forbiddenCode(
        requireMembership(test.db, owner, "00000000-0000-4000-8000-000000000000", ["owner"]),
      ),
    ).toBe("403 forbidden");
    expect(await forbiddenCode(requireMembership(test.db, owner, "not-a-uuid", ["owner"]))).toBe(
      "403 forbidden",
    );
    expect(await forbiddenCode(requireMembership(test.db, owner, orgId, []))).toBe("403 forbidden");
  });

  it("refuses a removed membership (403)", async () => {
    const former = await session();
    await test.db
      .insert(memberships)
      .values({ orgId, userId: former.userId, role: "approver", removedAt: new Date() });
    expect(await forbiddenCode(requireMembership(test.db, former, orgId, ["approver"]))).toBe(
      "403 forbidden",
    );
  });
});
