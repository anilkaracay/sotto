// POST /api/token-accounts (08 section 3, 06 section 3 step 5): the onchain checks before the owner's
// wUSDC account is recorded, idempotence, and the money gate of AC-02.2. The chain is a stand in for
// the server's RPC that serves encoded Token-2022 accounts.
import { memberships, orgs, recipients, tokenAccounts, users } from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { getClusterConfig } from "@sotto/sdk/cluster";
import { confidentialTokenAccount, encodeToken2022Account } from "@sotto/sdk/testing";
import { address, getAddressDecoder, getBase64Decoder, type Address } from "@solana/kit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSession, SESSION_COOKIE } from "../lib/server/session.ts";
import {
  APP_ORIGIN,
  apiRequest,
  createOrg,
  SESSION_SECRET,
  setUpApiTest,
  tearDownApiTest,
} from "./helpers/api.ts";

const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SLOT = 4242n;
const devnet = getClusterConfig("devnet");
const WUSDC = (devnet.available ? devnet.wrappedUsdcMint : null) as Address;
const ELGAMAL = address("BxMVLbjVntF9DJtDjfpQLrgw4hopedMgNkZZKGcVkZp6");

/** Accounts the stand in RPC serves: address to owner program and data. */
const chain = new Map<string, { owner: string; data: Uint8Array }>();
let reads = 0;

vi.mock("../lib/server/chain.ts", () => ({
  serverRpc: () => ({
    getAccountInfo: (target: string) => ({
      send: async () => {
        reads += 1;
        const account = chain.get(target);
        return {
          context: { slot: SLOT },
          value: account
            ? {
                data: [getBase64Decoder().decode(account.data), "base64"],
                executable: false,
                lamports: 2_039_280n,
                owner: account.owner,
                space: BigInt(account.data.length),
                rentEpoch: 0n,
              }
            : null,
        };
      },
    }),
  }),
}));

const { POST } = await import("../app/api/token-accounts/route.ts");

let test: TestDatabase;
let ip = 0;

/** A random valid address (32 bytes). */
const randomAddress = () => getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));

/** A user whose wallet is a valid address, with a session. */
async function createUserWithSession(database: TestDatabase) {
  const wallet = randomAddress();
  const [row] = await database.db.insert(users).values({ wallet }).returning({ id: users.id });
  if (!row) throw new Error("user not created");
  const { token } = await createSession(database.db, row.id, SESSION_SECRET);
  return { userId: row.id, wallet, cookie: `${SESSION_COOKIE}=${token}` };
}

beforeAll(async () => {
  test = await setUpApiTest();
});

afterAll(async () => {
  await tearDownApiTest(test);
});

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.unstubAllEnvs();
  vi.stubEnv("DATABASE_URL", test.url);
  vi.stubEnv("SESSION_SECRET", SESSION_SECRET);
  vi.stubEnv("RPC_URL", "https://devnet.helius-rpc.com/?api-key=test-key-sentinel");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_ORIGIN);
  vi.stubEnv("NEXT_PUBLIC_CLUSTER", "devnet");
  reads = 0;
});

function post(cookie: string | null, body: unknown) {
  ip += 1;
  return POST(
    apiRequest("/api/token-accounts", {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        origin: APP_ORIGIN,
        "content-type": "application/json",
        "x-forwarded-for": `198.19.${Math.floor(ip / 250)}.${ip % 250}`,
        ...(cookie ? { cookie } : {}),
      },
    }),
  );
}

async function errorOf(response: Response) {
  return ((await response.json()) as { error: { code: string; message: string } }).error;
}

/** An owner with a session and an org in the given status. */
async function owner(status: "pending_review" | "active" | "suspended" = "active") {
  const user = await createUserWithSession(test);
  const orgId = await createOrg(test, user.userId);
  await test.db.update(orgs).set({ status }).where(eq(orgs.id, orgId));
  return { ...user, orgId };
}

/** A token account onchain; returns its address. */
function onchain(
  token: Parameters<typeof confidentialTokenAccount>[0],
  program: string = TOKEN_2022,
): string {
  const at = randomAddress();
  chain.set(at, { owner: program, data: encodeToken2022Account(confidentialTokenAccount(token)) });
  return at;
}

describe("POST /api/token-accounts", () => {
  it("AC-03.3 records the owner's configured wUSDC account after the onchain checks, once", async () => {
    const user = await owner();
    const account = onchain({
      owner: address(user.wallet),
      mint: WUSDC,
      elgamalPubkey: ELGAMAL,
    });
    const body = { orgId: user.orgId, address: account, keyScheme: "standard_v1" };
    const created = await post(user.cookie, body);
    expect(created.status).toBe(201);
    const { tokenAccount } = (await created.json()) as {
      tokenAccount: { id: string; configuredSlot: string };
    };
    expect(tokenAccount).toMatchObject({
      orgId: user.orgId,
      cluster: "devnet",
      address: account,
      mint: WUSDC,
      keyScheme: "standard_v1",
      configuredSlot: SLOT.toString(),
    });
    const again = await post(user.cookie, body);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { tokenAccount: { id: string } }).tokenAccount.id).toBe(
      tokenAccount.id,
    );
    const rows = await test.db
      .select()
      .from(tokenAccounts)
      .where(eq(tokenAccounts.address, account));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: user.userId, applyFlaggedAt: null });
  });

  it("AC-07.3 lets a recipient record its own account, which makes the recipient ready", async () => {
    const org = await owner();
    const person = await createUserWithSession(test);
    await test.db
      .insert(memberships)
      .values({ orgId: org.orgId, userId: person.userId, role: "recipient" });
    const [row] = await test.db
      .insert(recipients)
      .values({
        orgId: org.orgId,
        displayName: "Maya",
        wallet: person.wallet,
        userId: person.userId,
      })
      .returning({ id: recipients.id, readiness: recipients.readiness });
    expect(row?.readiness).toBe("no_account");
    const account = onchain({ owner: address(person.wallet), mint: WUSDC, elgamalPubkey: ELGAMAL });
    const recorded = await post(person.cookie, {
      orgId: org.orgId,
      address: account,
      keyScheme: "standard_v1",
    });
    expect(recorded.status).toBe(201);
    const [after] = await test.db
      .select({ readiness: recipients.readiness, checkedAt: recipients.readinessCheckedAt })
      .from(recipients)
      .where(eq(recipients.id, row?.id ?? ""));
    expect(after?.readiness).toBe("ready");
    expect(after?.checkedAt).toBeInstanceOf(Date);
  });

  it("refuses accounts that fail an onchain check and stores nothing", async () => {
    const user = await owner();
    const me = address(user.wallet);
    const cases: [string, string][] = [
      [randomAddress(), "The token account does not exist onchain"],
      [
        onchain({ owner: me, mint: WUSDC, elgamalPubkey: ELGAMAL }, TOKEN),
        "The account is not a Token-2022 token account",
      ],
      [
        onchain({ owner: address(randomAddress()), mint: WUSDC, elgamalPubkey: ELGAMAL }),
        "The token account belongs to another wallet",
      ],
      [
        onchain({ owner: me, mint: address(randomAddress()), elgamalPubkey: ELGAMAL }),
        "The token account does not hold this network's wUSDC",
      ],
      [
        onchain({ owner: me, mint: WUSDC, elgamalPubkey: ELGAMAL, confidential: false }),
        "The token account is not configured for confidential balances",
      ],
      [
        onchain({ owner: me, mint: WUSDC, elgamalPubkey: ELGAMAL, approved: false }),
        "The token account is not approved for confidential balances",
      ],
    ];
    for (const [account, message] of cases) {
      const response = await post(user.cookie, {
        orgId: user.orgId,
        address: account,
        keyScheme: "standard_v1",
      });
      expect(response.status, message).toBe(422);
      expect(await errorOf(response)).toEqual({ code: "token_account_invalid", message });
    }
    const rows = await test.db
      .select()
      .from(tokenAccounts)
      .where(eq(tokenAccounts.userId, user.userId));
    expect(rows).toHaveLength(0);
  });

  it("AC-02.2 refuses non owners and organizations that are not verified, before reading the chain", async () => {
    const active = await owner();
    const account = onchain({
      owner: address(active.wallet),
      mint: WUSDC,
      elgamalPubkey: ELGAMAL,
    });
    const body = (orgId: string) => ({ orgId, address: account, keyScheme: "standard_v1" });

    const stranger = await createUserWithSession(test);
    expect(await errorOf(await post(stranger.cookie, body(active.orgId)))).toMatchObject({
      code: "forbidden",
    });
    const accountant = await createUserWithSession(test);
    await test.db
      .insert(memberships)
      .values({ orgId: active.orgId, userId: accountant.userId, role: "accountant" });
    const asAccountant = await post(accountant.cookie, body(active.orgId));
    expect(asAccountant.status).toBe(403);
    expect(await errorOf(asAccountant)).toMatchObject({ code: "forbidden" });

    const inReview = await owner("pending_review");
    const pending = await post(inReview.cookie, body(inReview.orgId));
    expect(pending.status).toBe(403);
    expect(await errorOf(pending)).toEqual({
      code: "org_not_active",
      message: "Money features open once Sotto verifies the organization",
    });
    const suspended = await owner("suspended");
    expect(await errorOf(await post(suspended.cookie, body(suspended.orgId)))).toEqual({
      code: "org_not_active",
      message: "Money features are disabled while the organization is not verified",
    });
    expect((await post(null, body(active.orgId))).status).toBe(401);
    expect(reads).toBe(0);
  });

  it("validates the body: only standard_v1, a base58 address and known fields", async () => {
    const user = await owner();
    const valid = { orgId: user.orgId, address: randomAddress(), keyScheme: "standard_v1" };
    for (const body of [
      { ...valid, keyScheme: "sotto_ikm_v1" },
      { ...valid, address: "not an address" },
      { ...valid, extra: true },
      { address: valid.address, keyScheme: "standard_v1" },
    ]) {
      const response = await post(user.cookie, body);
      expect(response.status).toBe(400);
      expect((await errorOf(response)).code).toBe("invalid_request");
    }
    expect(reads).toBe(0);
  });

  it("refuses an account another user recorded, and a cluster without a wrapped mint", async () => {
    const first = await owner();
    const second = await owner();
    const account = onchain({
      owner: address(second.wallet),
      mint: WUSDC,
      elgamalPubkey: ELGAMAL,
    });
    await test.db.insert(tokenAccounts).values({
      userId: first.userId,
      orgId: first.orgId,
      cluster: "devnet",
      address: account,
      mint: WUSDC,
      keyScheme: "standard_v1",
    });
    const taken = await post(second.cookie, {
      orgId: second.orgId,
      address: account,
      keyScheme: "standard_v1",
    });
    expect(taken.status).toBe(409);
    expect((await errorOf(taken)).code).toBe("token_account_taken");

    vi.stubEnv("NEXT_PUBLIC_CLUSTER", "localnet");
    const unavailable = await post(second.cookie, {
      orgId: second.orgId,
      address: account,
      keyScheme: "standard_v1",
    });
    expect(unavailable.status).toBe(503);
    expect((await errorOf(unavailable)).code).toBe("confidential_unavailable");
  });
});
