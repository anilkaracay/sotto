// The faucet's devnet SOL (step 4.6, D-31) against a test database: it refuses every cluster but
// devnet and a devnet configuration whose RPC serves another ledger; it needs a session; a wallet gets
// one grant in 24 hours, only while it holds less than 0.02 SOL; all wallets together get at most 1 SOL
// in 24 hours; failed grants count toward no limit; and requests at once never pass a limit together.
import { solGrants } from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { GENESIS_HASHES } from "@sotto/sdk/cluster";
import type { SolanaRpc } from "@sotto/sdk/tx";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../app/api/faucet/sol/route.ts";
import { serverCluster, type ServerCluster } from "../lib/server/cluster.ts";
import { ApiError } from "../lib/server/errors.ts";
import {
  readSolFaucet,
  requestSolGrant,
  SOL_BALANCE_CEILING_LAMPORTS,
  SOL_DAILY_TOTAL_LAMPORTS,
  SOL_GRANT_LAMPORTS,
} from "../lib/server/sol-faucet.ts";
import {
  createUserWithSession,
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

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  await test.db.delete(solGrants);
});

/** An RPC that answers the genesis hash and every wallet's balance. */
const ledger =
  (genesisHash: string, lamports = 0n) =>
  () =>
    ({
      getGenesisHash: () => ({ send: async () => genesisHash }),
      getBalance: () => ({ send: async () => ({ value: lamports }) }),
    }) as unknown as SolanaRpc;
const devnetLedger = (lamports = 0n) => ledger(GENESIS_HASHES.devnet, lamports);

async function devnet(): Promise<ServerCluster> {
  const cluster = await serverCluster({ NEXT_PUBLIC_CLUSTER: "devnet" });
  if (!cluster) throw new Error("devnet is available");
  return cluster;
}

async function wallet() {
  const user = await createUserWithSession(test);
  return { ...user, session: { id: "s", userId: user.userId, wallet: user.wallet } };
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return `${error.status} ${error.code}: ${error.message}`;
    throw error;
  }
  throw new Error("expected a refusal");
}

describe("the SOL faucet's cluster guard", () => {
  it("refuses localnet and mainnet through the route, and needs a session", async () => {
    const user = await wallet();
    const devnetOnly = {
      code: "sol_faucet_devnet_only",
      message: "The SOL faucet runs on devnet only",
    };
    for (const cluster of ["localnet", "mainnet"]) {
      vi.stubEnv("NEXT_PUBLIC_CLUSTER", cluster);
      try {
        const read = await GET(jsonRequest("/api/faucet/sol", "GET", user.cookie));
        expect(read.status).toBe(403);
        expect(await errorOf(read)).toEqual(devnetOnly);
        const posted = await POST(jsonRequest("/api/faucet/sol", "POST", user.cookie, {}));
        expect(posted.status).toBe(403);
        expect(await errorOf(posted)).toEqual(devnetOnly);
      } finally {
        vi.stubEnv("NEXT_PUBLIC_CLUSTER", "");
      }
    }
    expect((await GET(jsonRequest("/api/faucet/sol", "GET", null))).status).toBe(401);
    expect((await POST(jsonRequest("/api/faucet/sol", "POST", null, {}))).status).toBe(401);
    expect(await test.db.select().from(solGrants)).toEqual([]);
  });

  it("refuses a devnet configuration whose RPC serves another ledger, or none", async () => {
    const user = await wallet();
    const cluster = await devnet();
    expect(
      await refusal(
        requestSolGrant(test.db, user.session, cluster, ledger(GENESIS_HASHES.mainnet)),
      ),
    ).toBe("403 sol_faucet_devnet_only: The SOL faucet runs on devnet only");
    expect(
      await refusal(
        requestSolGrant(test.db, user.session, cluster, ledger("some local ledger's hash")),
      ),
    ).toBe("403 sol_faucet_devnet_only: The SOL faucet runs on devnet only");
    const unreachable = () =>
      ({
        getGenesisHash: () => ({
          send: async () => {
            throw new Error("connect ECONNREFUSED");
          },
        }),
      }) as unknown as SolanaRpc;
    expect(await refusal(requestSolGrant(test.db, user.session, cluster, unreachable))).toBe(
      "503 sol_faucet_network_unreachable: The network could not be reached. Try again.",
    );
    expect(await test.db.select().from(solGrants)).toEqual([]);
  });
});

describe("the SOL faucet on devnet", () => {
  it("gives a wallet 0.05 SOL once in 24 hours, a failed grant left out", async () => {
    const user = await wallet();
    const cluster = await devnet();
    const now = new Date("2026-10-09T12:00:00.000Z");
    expect(await readSolFaucet(test.db, user.session, cluster, devnetLedger(), now)).toMatchObject({
      wallet: user.wallet,
      grantLamports: "50000000",
      ceilingLamports: "20000000",
      balanceLamports: "0",
      state: "available",
      nextAt: null,
      grants: [],
    });

    const grant = await requestSolGrant(test.db, user.session, cluster, devnetLedger(), now);
    expect(grant).toMatchObject({ lamports: "50000000", status: "pending", signature: null });
    const [row] = await test.db.select().from(solGrants).where(eq(solGrants.id, grant.id));
    expect(row).toMatchObject({ userId: user.userId, wallet: user.wallet, lamports: 50_000_000n });

    const later = new Date(now.getTime() + 23 * 3600 * 1000);
    expect(
      await refusal(requestSolGrant(test.db, user.session, cluster, devnetLedger(), later)),
    ).toBe("429 sol_faucet_limit: A wallet can get devnet SOL once in 24 hours");
    expect(
      await readSolFaucet(test.db, user.session, cluster, devnetLedger(), later),
    ).toMatchObject({ state: "used", nextAt: "2026-10-10T12:00:00.000Z" });

    // A grant that failed counts toward no limit; nor does one older than 24 hours.
    await test.db.update(solGrants).set({ status: "failed" }).where(eq(solGrants.id, grant.id));
    const second = await requestSolGrant(test.db, user.session, cluster, devnetLedger(), later);
    const nextDay = new Date(later.getTime() + 24 * 3600 * 1000 + 1);
    expect(
      await readSolFaucet(test.db, user.session, cluster, devnetLedger(), nextDay),
    ).toMatchObject({ state: "available", nextAt: null });
    expect(second.id).not.toBe(grant.id);
  });

  it("keeps its SOL for wallets that hold less than 0.02 SOL", async () => {
    const user = await wallet();
    const cluster = await devnet();
    const enough = devnetLedger(SOL_BALANCE_CEILING_LAMPORTS);
    expect(await readSolFaucet(test.db, user.session, cluster, enough)).toMatchObject({
      state: "not_needed",
      balanceLamports: "20000000",
    });
    expect(await refusal(requestSolGrant(test.db, user.session, cluster, enough))).toBe(
      "409 sol_faucet_not_needed: Your wallet already holds enough SOL for fees, so the faucet keeps its SOL for wallets that have none",
    );
    const almost = devnetLedger(SOL_BALANCE_CEILING_LAMPORTS - 1n);
    expect((await requestSolGrant(test.db, user.session, cluster, almost)).status).toBe("pending");
    expect(await test.db.select().from(solGrants)).toHaveLength(1);
  });

  it("gives all wallets together at most 1 SOL in 24 hours, also with requests at once", async () => {
    const cluster = await devnet();
    const now = new Date("2026-10-09T12:00:00.000Z");
    const grants = Number(SOL_DAILY_TOTAL_LAMPORTS / SOL_GRANT_LAMPORTS);
    expect(grants).toBe(20);
    // 18 grants of other wallets earlier in the day leave room for two more.
    const filler = await wallet();
    await test.db.insert(solGrants).values(
      Array.from({ length: grants - 2 }, (_, index) => ({
        userId: filler.userId,
        wallet: filler.wallet,
        lamports: SOL_GRANT_LAMPORTS,
        status: "paid" as const,
        createdAt: new Date(now.getTime() - (index + 1) * 60_000),
      })),
    );
    const wallets = await Promise.all([wallet(), wallet(), wallet(), wallet()]);
    const results = await Promise.all(
      wallets.map((user) =>
        requestSolGrant(test.db, user.session, cluster, devnetLedger(), now).then(
          () => "granted",
          (error: unknown) => (error instanceof ApiError ? error.code : String(error)),
        ),
      ),
    );
    expect(results.filter((result) => result === "granted")).toHaveLength(2);
    expect(results.filter((result) => result === "sol_faucet_daily_total")).toHaveLength(2);
    const refused = wallets[results.indexOf("sol_faucet_daily_total")];
    if (!refused) throw new Error("one wallet was refused");
    expect(
      await readSolFaucet(test.db, refused.session, cluster, devnetLedger(), now),
    ).toMatchObject({ state: "daily_total" });
    expect(
      await refusal(requestSolGrant(test.db, refused.session, cluster, devnetLedger(), now)),
    ).toBe(
      "429 sol_faucet_daily_total: The faucet has given out its SOL for today. Get devnet SOL at https://faucet.solana.com or try again tomorrow",
    );
  });

  it("lets one wallet's requests at once take one grant", async () => {
    const user = await wallet();
    const cluster = await devnet();
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        requestSolGrant(test.db, user.session, cluster, devnetLedger()).then(
          () => "granted",
          (error: unknown) => (error instanceof ApiError ? error.code : String(error)),
        ),
      ),
    );
    expect(results.sort()).toEqual(["granted", "sol_faucet_limit", "sol_faucet_limit"]);
    expect(await test.db.select().from(solGrants)).toHaveLength(1);
  });
});
