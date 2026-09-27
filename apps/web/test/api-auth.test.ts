// F-01 sign in (AC-01.1 to AC-01.3) against a test database, with real Ed25519 keys.
import { authNonces, sessions } from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { generateKeyPair, getAddressFromPublicKey, getBase64Decoder, signBytes } from "@solana/kit";
import { createSignInMessageText } from "@solana/wallet-standard-util";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as logout } from "../app/api/auth/logout/route.ts";
import { POST as nonce } from "../app/api/auth/nonce/route.ts";
import { POST as verify } from "../app/api/auth/verify/route.ts";
import { GET as me } from "../app/api/me/route.ts";
import { SIGN_IN_STATEMENT, type SignInInput } from "../lib/server/auth.ts";
import { APP_ORIGIN, apiRequest, setUpApiTest, tearDownApiTest } from "./helpers/api.ts";

let test: TestDatabase;
const base64 = getBase64Decoder();

beforeAll(async () => {
  test = await setUpApiTest();
});
afterAll(async () => {
  await tearDownApiTest(test);
});
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

type Wallet = { address: string; sign: (bytes: Uint8Array) => Promise<Uint8Array> };

async function newWallet(): Promise<Wallet> {
  const keys = await generateKeyPair();
  return {
    address: await getAddressFromPublicKey(keys.publicKey),
    sign: async (bytes) => new Uint8Array(await signBytes(keys.privateKey, bytes)),
  };
}

let ip = 0;
/** Each request comes from its own client IP, so the per IP auth limit does not couple the tests. */
function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  ip += 1;
  return apiRequest(path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      origin: APP_ORIGIN,
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${ip % 250}`,
      ...headers,
    },
  });
}

async function issue(wallet: Wallet): Promise<{ input: SignInInput; message: string }> {
  const response = await nonce(post("/api/auth/nonce", { wallet: wallet.address }));
  expect(response.status).toBe(200);
  return (await response.json()) as { input: SignInInput; message: string };
}

async function verifyText(wallet: Wallet, text: string, signer: Wallet = wallet) {
  const bytes = new TextEncoder().encode(text);
  const signature = await signer.sign(bytes);
  return verify(
    post("/api/auth/verify", {
      wallet: wallet.address,
      message: base64.decode(bytes),
      signature: base64.decode(signature),
    }),
  );
}

function cookieOf(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  return header.split(";")[0] ?? "";
}

async function errorCode(response: Response): Promise<string> {
  return `${response.status} ${((await response.json()) as { error: { code: string } }).error.code}`;
}

describe("F-01 sign in", () => {
  it("AC-01.1 signs in with a signed message and sets an httpOnly, Secure, SameSite=Lax session cookie", async () => {
    const wallet = await newWallet();
    const { input, message } = await issue(wallet);
    expect(input).toMatchObject({
      domain: "localhost:3000",
      address: wallet.address,
      statement: SIGN_IN_STATEMENT,
      uri: APP_ORIGIN,
      version: "1",
    });
    expect(message).toBe(createSignInMessageText(input));
    const response = await verifyText(wallet, message);
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^sotto_session=[A-Za-z0-9_-]{43}; /);
    for (const attribute of ["HttpOnly", "SameSite=Lax", "Secure", "Path=/"])
      expect(setCookie).toContain(attribute);
    const body = (await response.json()) as { user: { wallet: string } };
    expect(body.user.wallet).toBe(wallet.address);
    const profile = await me(apiRequest("/api/me", { headers: { cookie: cookieOf(response) } }));
    expect(profile.status).toBe(200);
    expect(await profile.json()).toMatchObject({
      user: { wallet: wallet.address, displayName: null },
      memberships: [],
      isAdmin: false,
    });
  });

  it("AC-01.1 accepts the text a solana:signIn wallet builds from the fields, with or without a chain ID", async () => {
    const wallet = await newWallet();
    const { input } = await issue(wallet);
    expect((await verifyText(wallet, createSignInMessageText(input))).status).toBe(200);
    const second = await newWallet();
    const issued = await issue(second);
    const withChain = createSignInMessageText({ ...issued.input, chainId: "solana:devnet" });
    expect((await verifyText(second, withChain)).status).toBe(200);
  });

  it("AC-01.2 rejects a replayed sign in message", async () => {
    const wallet = await newWallet();
    const { message } = await issue(wallet);
    expect((await verifyText(wallet, message)).status).toBe(200);
    expect(await errorCode(await verifyText(wallet, message))).toBe("401 sign_in_expired");
  });

  it("AC-01.2 rejects an expired sign in message", async () => {
    const wallet = await newWallet();
    const { input, message } = await issue(wallet);
    await test.db
      .update(authNonces)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(authNonces.nonce, input.nonce ?? ""));
    expect(await errorCode(await verifyText(wallet, message))).toBe("401 sign_in_expired");
  });

  it("AC-01.2 rejects a message whose times, domain, wallet, fields or signature are not the issued ones", async () => {
    const wallet = await newWallet();
    const { input } = await issue(wallet);
    const other = await newWallet();
    const later = new Date(Date.parse(input.issuedAt ?? "") + 60_000);
    const cases: [string, string, Wallet?][] = [
      [
        "later times",
        createSignInMessageText({
          ...input,
          issuedAt: later.toISOString(),
          expirationTime: new Date(later.getTime() + 300_000).toISOString(),
        }),
      ],
      [
        "another domain",
        createSignInMessageText({ ...input, domain: "evil.example", uri: "https://evil.example" }),
      ],
      [
        "another statement",
        createSignInMessageText({ ...input, statement: "Sign in to something else." }),
      ],
      ["a request ID", createSignInMessageText({ ...input, requestId: "x" })],
      ["extra text", createSignInMessageText(input) + "\nhidden line"],
      ["another signer", createSignInMessageText(input), other],
    ];
    for (const [label, text, signer] of cases) {
      const response = await verifyText(wallet, text, signer);
      expect(response.status, label).toBe(401);
    }
    const mismatch = createSignInMessageText({ ...input, address: other.address });
    expect(await errorCode(await verifyText(wallet, mismatch))).toBe("401 sign_in_invalid");
    // The issued nonce survives failed attempts, so a stranger cannot burn it with bad signatures.
    expect((await verifyText(wallet, createSignInMessageText(input))).status).toBe(200);
  });

  it("AC-01.2 refuses sign in requests without the app's Origin", async () => {
    const wallet = await newWallet();
    const response = await nonce(
      apiRequest("/api/auth/nonce", {
        method: "POST",
        body: JSON.stringify({ wallet: wallet.address }),
        headers: { "content-type": "application/json", origin: "https://evil.example" },
      }),
    );
    expect(await errorCode(response)).toBe("403 forbidden_origin");
    expect(await errorCode(await nonce(post("/api/auth/nonce", { wallet: "not-a-wallet" })))).toBe(
      "400 invalid_request",
    );
  });

  it("AC-01.2 limits sign in requests per client IP", async () => {
    const wallet = await newWallet();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const response = await nonce(
        post("/api/auth/nonce", { wallet: wallet.address }, { "x-forwarded-for": "192.0.2.77" }),
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("AC-01.3 signing out invalidates the session server side", async () => {
    const wallet = await newWallet();
    const { message } = await issue(wallet);
    const cookie = cookieOf(await verifyText(wallet, message));
    expect((await me(apiRequest("/api/me", { headers: { cookie } }))).status).toBe(200);
    const out = await logout(post("/api/auth/logout", {}, { cookie }));
    expect(out.status).toBe(204);
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await errorCode(await me(apiRequest("/api/me", { headers: { cookie } })))).toBe(
      "401 unauthenticated",
    );
    const revoked = await test.db.select({ revokedAt: sessions.revokedAt }).from(sessions);
    expect(revoked.filter((row) => row.revokedAt !== null)).toHaveLength(1);
  });
});
