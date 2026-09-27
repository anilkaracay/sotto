// Shared setup for API tests: a fresh migrated database, server configuration in process.env, a user
// with a session cookie, and request builders.
import { orgs, memberships, users } from "@sotto/db";
import { createTestDatabase, type TestDatabase } from "@sotto/db/testing";
import { vi } from "vitest";
import { closeDbClients } from "../../lib/server/db.ts";
import { createSession, SESSION_COOKIE } from "../../lib/server/session.ts";

export const APP_ORIGIN = "http://localhost:3000";
export const SESSION_SECRET = "test-session-secret-0123456789abcdef";
export const RPC_URL = "https://devnet.helius-rpc.com/?api-key=test-key-sentinel";

export async function setUpApiTest(): Promise<TestDatabase> {
  const test = await createTestDatabase();
  vi.stubEnv("DATABASE_URL", test.url);
  vi.stubEnv("SESSION_SECRET", SESSION_SECRET);
  vi.stubEnv("RPC_URL", RPC_URL);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_ORIGIN);
  return test;
}

export async function tearDownApiTest(test: TestDatabase | undefined): Promise<void> {
  vi.unstubAllEnvs();
  await closeDbClients();
  await test?.drop();
}

let walletCounter = 0;
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** A distinct, well formed (not necessarily on curve) base58 wallet string for tests. */
export function testWallet(): string {
  walletCounter += 1;
  let n = walletCounter;
  let suffix = "";
  do {
    suffix = BASE58[n % 58] + suffix;
    n = Math.floor(n / 58);
  } while (n > 0);
  return ("So1testWa11et" + "1".repeat(44)).slice(0, 44 - suffix.length) + suffix;
}

export async function createUser(test: TestDatabase): Promise<{ userId: string; wallet: string }> {
  const wallet = testWallet();
  const [row] = await test.db.insert(users).values({ wallet }).returning({ id: users.id });
  if (!row) throw new Error("user not created");
  return { userId: row.id, wallet };
}

export async function createUserWithSession(
  test: TestDatabase,
): Promise<{ userId: string; wallet: string; token: string; cookie: string }> {
  const user = await createUser(test);
  const { token } = await createSession(test.db, user.userId, SESSION_SECRET);
  return { ...user, token, cookie: `${SESSION_COOKIE}=${token}` };
}

export async function createOrg(test: TestDatabase, ownerUserId: string): Promise<string> {
  const [row] = await test.db
    .insert(orgs)
    .values({
      displayName: "Northwind Labs",
      legalName: "Northwind Labs Ltd",
      country: "TR",
      registrationNo: "0001",
      website: "https://northwind.example",
      contactEmail: "ops@northwind.example",
      ownerUserId,
    })
    .returning({ id: orgs.id });
  if (!row) throw new Error("org not created");
  await test.db.insert(memberships).values({ orgId: row.id, userId: ownerUserId, role: "owner" });
  return row.id;
}

export function apiRequest(
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Request {
  return new Request(`${APP_ORIGIN}${path}`, {
    method: init.method ?? "GET",
    headers: init.headers ?? {},
    ...(init.body === undefined ? {} : { body: init.body }),
  });
}

let keySeed = 100;

/** A user whose wallet is a real Ed25519 keypair (so it can sign messages), with a session. */
export async function createKeyUser(test: TestDatabase): Promise<{
  userId: string;
  wallet: string;
  cookie: string;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
}> {
  keySeed += 1;
  const { createKeyPairFromPrivateKeyBytes, getAddressFromPublicKey, signBytes } =
    await import("@solana/kit");
  const keys = await createKeyPairFromPrivateKeyBytes(new Uint8Array(32).fill(keySeed % 256));
  const wallet = await getAddressFromPublicKey(keys.publicKey);
  const [row] = await test.db.insert(users).values({ wallet }).returning({ id: users.id });
  if (!row) throw new Error("user not created");
  const { token } = await createSession(test.db, row.id, SESSION_SECRET);
  return {
    userId: row.id,
    wallet,
    cookie: `${SESSION_COOKIE}=${token}`,
    sign: async (message) => new Uint8Array(await signBytes(keys.privateKey, message)),
  };
}

/** An org of the owner in the given status. */
export async function createOrgWithStatus(
  test: TestDatabase,
  ownerUserId: string,
  status: "pending_review" | "active" | "suspended",
): Promise<string> {
  const orgId = await createOrg(test, ownerUserId);
  const { eq } = await import("drizzle-orm");
  await test.db.update(orgs).set({ status }).where(eq(orgs.id, orgId));
  return orgId;
}

let ipCounter = 0;

/** A JSON request with the app Origin, a session cookie and a fresh client IP. */
export function jsonRequest(
  path: string,
  method: string,
  cookie: string | null,
  body?: unknown,
): Request {
  ipCounter += 1;
  return apiRequest(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      origin: APP_ORIGIN,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "x-forwarded-for": `198.21.${Math.floor(ipCounter / 250) % 250}.${ipCounter % 250}`,
      ...(cookie ? { cookie } : {}),
    },
  });
}

export async function errorOf(response: Response): Promise<{ code: string; message: string }> {
  return ((await response.json()) as { error: { code: string; message: string } }).error;
}
