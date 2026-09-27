// POST /api/viewer-keys and GET /api/users/:id/viewer-key (07 section 5, I-8).
import { memberships, users, viewerKeys } from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { verifyViewKeyRegistration, viewKeyRegistrationMessage } from "@sotto/sdk/keys/public";
import { createKeyPairFromPrivateKeyBytes, getAddressFromPublicKey, signBytes } from "@solana/kit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/users/[id]/viewer-key/route.ts";
import { POST } from "../app/api/viewer-keys/route.ts";
import { createSession, SESSION_COOKIE } from "../lib/server/session.ts";
import {
  APP_ORIGIN,
  apiRequest,
  createOrg,
  SESSION_SECRET,
  setUpApiTest,
  tearDownApiTest,
} from "./helpers/api.ts";

type KeyUser = {
  userId: string;
  wallet: string;
  cookie: string;
  sign: (message: Uint8Array) => Promise<Uint8Array>;
};

let test: TestDatabase;
let seedCounter = 0;
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

/** A user whose wallet is a real Ed25519 keypair, with a session. */
async function keyUser(): Promise<KeyUser> {
  seedCounter += 1;
  const keys = await createKeyPairFromPrivateKeyBytes(new Uint8Array(32).fill(seedCounter));
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

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

function register(user: KeyUser | null, body: unknown, headers: Record<string, string> = {}) {
  ip += 1;
  return POST(
    apiRequest("/api/viewer-keys", {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        origin: APP_ORIGIN,
        "content-type": "application/json",
        "x-forwarded-for": `198.18.${Math.floor(ip / 250)}.${ip % 250}`,
        ...(user ? { cookie: user.cookie } : {}),
        ...headers,
      },
    }),
  );
}

function read(user: KeyUser, id: string) {
  return GET(apiRequest(`/api/users/${id}/viewer-key`, { headers: { cookie: user.cookie } }), {
    params: Promise.resolve({ id }),
  });
}

async function errorOf(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string; message: string } };
  return `${response.status} ${body.error.code}: ${body.error.message}`;
}

async function registration(user: KeyUser, fill: number) {
  const publicKey = new Uint8Array(32).fill(fill);
  const signature = await user.sign(viewKeyRegistrationMessage(publicKey));
  return { publicKey, signature, body: { publicKey: b64(publicKey), signature: b64(signature) } };
}

async function keysOf(userId: string) {
  return test.db
    .select({ publicKey: viewerKeys.publicKey, status: viewerKeys.status })
    .from(viewerKeys)
    .where(eq(viewerKeys.userId, userId));
}

describe("POST /api/viewer-keys", () => {
  it("stores a key signed by the caller's wallet, keeps one active and rotates the previous one", async () => {
    const user = await keyUser();
    const first = await registration(user, 1);
    const created = await register(user, first.body);
    expect(created.status).toBe(201);
    expect(((await created.json()) as { viewerKey: unknown }).viewerKey).toMatchObject({
      userId: user.userId,
      wallet: user.wallet,
      publicKey: first.body.publicKey,
      signature: first.body.signature,
      status: "active",
    });

    // The same key again changes nothing.
    const again = await register(user, first.body);
    expect(again.status).toBe(200);
    expect(await keysOf(user.userId)).toHaveLength(1);

    const second = await registration(user, 2);
    expect((await register(user, second.body)).status).toBe(201);
    const rows = await keysOf(user.userId);
    expect(rows.map((row) => row.status).sort()).toEqual(["active", "rotated"]);
    expect(Buffer.from(rows.find((row) => row.status === "active")?.publicKey ?? [])).toEqual(
      Buffer.from(second.publicKey),
    );
  });

  it("refuses a registration that the caller's wallet did not sign", async () => {
    const user = await keyUser();
    const other = await keyUser();
    const good = await registration(user, 5);
    const cases = [
      // Signed by another wallet.
      (await registration(other, 5)).body,
      // The signature of another key.
      { publicKey: b64(new Uint8Array(32).fill(6)), signature: good.body.signature },
      // Another message.
      {
        publicKey: good.body.publicKey,
        signature: b64(await user.sign(new TextEncoder().encode("sotto-view-key/v1"))),
      },
    ];
    for (const body of cases) {
      expect(await errorOf(await register(user, body))).toBe(
        "400 viewer_key_signature_invalid: The signature is not this wallet's signature of the viewing key registration",
      );
    }
    expect(await keysOf(user.userId)).toEqual([]);
  });

  it("validates the body, needs a session and a same origin request", async () => {
    const user = await keyUser();
    const good = await registration(user, 7);
    const invalid: [unknown, string][] = [
      [
        { publicKey: "not base64!", signature: good.body.signature },
        "publicKey: publicKey must be 32 bytes in base64",
      ],
      [
        { publicKey: b64(new Uint8Array(31)), signature: good.body.signature },
        "publicKey: publicKey must be 32 bytes in base64",
      ],
      [
        { publicKey: good.body.publicKey, signature: b64(new Uint8Array(63)) },
        "signature: signature must be 64 bytes in base64",
      ],
      [{ publicKey: good.body.publicKey }, "signature: signature must be base64"],
      [{ ...good.body, userId: user.userId }, 'body: Unrecognized key: "userId"'],
    ];
    for (const [body, message] of invalid) {
      expect(await errorOf(await register(user, body))).toBe(
        `400 invalid_request: Invalid request: ${message}`,
      );
    }
    expect((await register(null, good.body)).status).toBe(401);
    expect((await register(user, good.body, { origin: "https://evil.example" })).status).toBe(403);
  });
});

describe("GET /api/users/:id/viewer-key", () => {
  it("returns the key with its signature to the user and to owners of the user's orgs", async () => {
    const owner = await keyUser();
    const member = await keyUser();
    const outsider = await keyUser();
    const orgId = await createOrg(test, owner.userId);
    await test.db.insert(memberships).values({ orgId, userId: member.userId, role: "recipient" });
    expect(await errorOf(await read(member, member.userId))).toBe(
      "404 viewer_key_not_found: This user has no viewing key yet",
    );
    const key = await registration(member, 9);
    expect((await register(member, key.body)).status).toBe(201);

    for (const reader of [member, owner]) {
      const response = await read(reader, member.userId);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const { viewerKey } = (await response.json()) as {
        viewerKey: { wallet: string; publicKey: string; signature: string };
      };
      expect(viewerKey).toMatchObject({ wallet: member.wallet, publicKey: key.body.publicKey });
      // What the owner's browser checks before encrypting to the key (I-8).
      expect(
        await verifyViewKeyRegistration({
          wallet: viewerKey.wallet,
          publicKey: new Uint8Array(Buffer.from(viewerKey.publicKey, "base64")),
          signature: new Uint8Array(Buffer.from(viewerKey.signature, "base64")),
        }),
      ).toBe(true);
    }
    expect(await errorOf(await read(outsider, member.userId))).toBe(
      "403 forbidden: You do not have access to this resource",
    );
    // A member cannot read the keys of other members of the same org.
    expect((await read(member, owner.userId)).status).toBe(403);
    expect((await read(owner, "not-a-uuid")).status).toBe(403);
  });

  it("I-8 a key swapped on the server fails the browser's registration check", async () => {
    const user = await keyUser();
    const key = await registration(user, 11);
    expect((await register(user, key.body)).status).toBe(201);
    // A compromised server replaces the stored key with one it controls.
    await test.db
      .update(viewerKeys)
      .set({ publicKey: new Uint8Array(32).fill(12) })
      .where(eq(viewerKeys.userId, user.userId));
    const { viewerKey } = (await (await read(user, user.userId)).json()) as {
      viewerKey: { wallet: string; publicKey: string; signature: string };
    };
    expect(
      await verifyViewKeyRegistration({
        wallet: viewerKey.wallet,
        publicKey: new Uint8Array(Buffer.from(viewerKey.publicKey, "base64")),
        signature: new Uint8Array(Buffer.from(viewerKey.signature, "base64")),
      }),
    ).toBe(false);
  });
});
