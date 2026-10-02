// The devUSD faucet's web side (step 4.3, D-29; founder, 2026-10-02) against a test database: it
// refuses every cluster but devnet, and a devnet configuration whose RPC serves another ledger (the CI
// proof of the cluster guard); it serves only the owner of an active devUSD organization; and a wallet
// gets at most 10,000 devUSD in 24 hours, failed mints left out, even with two requests at once.
import { faucetMints, orgs } from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { GENESIS_HASHES } from "@sotto/sdk/cluster";
import { assetConfig } from "@sotto/sdk/cluster/assets";
import type { SolanaRpc } from "@sotto/sdk/tx";
import { address } from "@solana/kit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../app/api/orgs/[id]/faucet/route.ts";
import { serverCluster, type ServerCluster } from "../lib/server/cluster.ts";
import { FAUCET_LIMIT, readFaucet, requestFaucet } from "../lib/server/faucet.ts";
import { ApiError } from "../lib/server/errors.ts";
import {
  createOrgWithStatus,
  createUserWithSession,
  errorOf,
  jsonRequest,
  setUpApiTest,
  tearDownApiTest,
} from "./helpers/api.ts";

const DEVUSD = 1_000_000n;
const MINT = address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

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

/** An RPC whose only answer is the genesis hash. */
const ledger = (genesisHash: string) => () =>
  ({ getGenesisHash: () => ({ send: async () => genesisHash }) }) as unknown as SolanaRpc;

/** Devnet's configuration with devUSD in its registry, as it will be once devUSD exists there. */
async function devnetWithDevusd(): Promise<ServerCluster> {
  const devnet = await serverCluster({ NEXT_PUBLIC_CLUSTER: "devnet" });
  if (!devnet) throw new Error("devnet is available");
  return {
    ...devnet,
    assets: [
      ...devnet.assets,
      assetConfig("devusd", { baseMint: MINT, wrappedMint: MINT, sottoProofs: null }),
    ],
  };
}

async function devusdOwner(status: "active" | "pending_review" = "active") {
  const owner = await createUserWithSession(test);
  const orgId = await createOrgWithStatus(test, owner.userId, status);
  await test.db.update(orgs).set({ asset: "devusd" }).where(eq(orgs.id, orgId));
  return { ...owner, orgId, session: { id: "s", userId: owner.userId, wallet: owner.wallet } };
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

describe("the devUSD faucet's cluster guard (CI proof)", () => {
  it("refuses localnet, mainnet, and devnet without devUSD, through the route", async () => {
    const owner = await devusdOwner();
    const path = `/api/orgs/${owner.orgId}/faucet`;
    const params = { params: Promise.resolve({ id: owner.orgId }) };
    for (const cluster of ["localnet", "mainnet", "devnet"]) {
      vi.stubEnv("NEXT_PUBLIC_CLUSTER", cluster);
      vi.stubEnv("LOCALNET_DEVUSD_MINT", MINT);
      try {
        const posted = await POST(
          jsonRequest(path, "POST", owner.cookie, { amount: "10" }),
          params,
        );
        expect(posted.status).toBe(403);
        expect(await errorOf(posted)).toEqual({
          code: "faucet_devnet_only",
          message: "The devUSD faucet runs on devnet only",
        });
        const read = await GET(jsonRequest(path, "GET", owner.cookie), params);
        expect((await errorOf(read)).code).toBe("faucet_devnet_only");
      } finally {
        vi.stubEnv("NEXT_PUBLIC_CLUSTER", "");
        vi.stubEnv("LOCALNET_DEVUSD_MINT", "");
      }
    }
    expect(await test.db.select().from(faucetMints)).toEqual([]);
  });

  it("refuses a devnet configuration whose RPC serves another ledger", async () => {
    const owner = await devusdOwner();
    const cluster = await devnetWithDevusd();
    for (const genesis of [
      GENESIS_HASHES.mainnet,
      "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
    ]) {
      expect(
        await refusal(
          requestFaucet(test.db, owner.session, cluster, ledger(genesis), owner.orgId, DEVUSD),
        ),
      ).toBe("403 faucet_devnet_only: The devUSD faucet runs on devnet only");
    }
    expect(await test.db.select().from(faucetMints)).toEqual([]);
  });
});

describe("the devUSD faucet on devnet", () => {
  const devnet = ledger(GENESIS_HASHES.devnet);

  it("gives at most 10,000 devUSD per wallet in 24 hours, failed mints left out", async () => {
    const owner = await devusdOwner();
    const cluster = await devnetWithDevusd();
    const now = new Date("2026-10-02T10:00:00Z");
    const ask = (amount: bigint, at = now) =>
      requestFaucet(test.db, owner.session, cluster, devnet, owner.orgId, amount, at);
    const first = await ask(6_000n * DEVUSD);
    expect(first).toMatchObject({ amount: "6000000000", status: "pending", signature: null });
    await ask(4_000n * DEVUSD);
    expect(await refusal(ask(1n))).toBe(
      "429 faucet_limit: A wallet can get at most 10000 devUSD in 24 hours; 0 devUSD is left",
    );
    await test.db.update(faucetMints).set({ status: "failed" }).where(eq(faucetMints.id, first.id));
    expect(await refusal(ask(6_000n * DEVUSD + 1n))).toMatch(/; 6000 devUSD is left$/);
    await ask(6_000n * DEVUSD);
    // A day later the window has moved on.
    await ask(FAUCET_LIMIT, new Date(now.getTime() + 24 * 60 * 60 * 1000 + 1));
    const view = await readFaucet(test.db, owner.session, cluster, devnet, owner.orgId, now);
    expect(view).toMatchObject({ wallet: owner.wallet, limit: "10000000000", remaining: "0" });
    // Three of them share a time, so their order is not fixed.
    expect(view.mints.map((mint) => mint.status).sort()).toEqual([
      "failed",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("lets two requests at once take no more than the limit together", async () => {
    const owner = await devusdOwner();
    const cluster = await devnetWithDevusd();
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        requestFaucet(test.db, owner.session, cluster, devnet, owner.orgId, 6_000n * DEVUSD),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rows = await test.db
      .select()
      .from(faucetMints)
      .where(eq(faucetMints.wallet, owner.wallet));
    expect(rows).toHaveLength(1);
  });

  it("serves only the owner of an active devUSD organization", async () => {
    const cluster = await devnetWithDevusd();
    const usdc = await devusdOwner();
    await test.db.update(orgs).set({ asset: "usdc" }).where(eq(orgs.id, usdc.orgId));
    expect(
      await refusal(requestFaucet(test.db, usdc.session, cluster, devnet, usdc.orgId, DEVUSD)),
    ).toBe("409 faucet_not_devusd: This organization holds USDC; the faucet gives devUSD only");
    const review = await devusdOwner("pending_review");
    expect(
      await refusal(requestFaucet(test.db, review.session, cluster, devnet, review.orgId, DEVUSD)),
    ).toBe("403 org_not_active: Money features open once Sotto verifies the organization");
    const owner = await devusdOwner();
    const stranger = await createUserWithSession(test);
    const session = { id: "s", userId: stranger.userId, wallet: stranger.wallet };
    expect(
      await refusal(requestFaucet(test.db, session, cluster, devnet, owner.orgId, DEVUSD)),
    ).toBe("403 forbidden: You do not have access to this resource");
  });

  it("takes an amount of devUSD and refuses anything else", async () => {
    const owner = await devusdOwner();
    const path = `/api/orgs/${owner.orgId}/faucet`;
    const params = { params: Promise.resolve({ id: owner.orgId }) };
    for (const body of [{ amount: "0" }, { amount: "-1" }, { amount: "1.0000001" }, {}]) {
      const response = await POST(jsonRequest(path, "POST", owner.cookie, body), params);
      expect(response.status).toBe(400);
    }
    const extra = await POST(
      jsonRequest(path, "POST", owner.cookie, { amount: "1", wallet: owner.wallet }),
      params,
    );
    expect((await errorOf(extra)).message).toMatch(/Unrecognized key: "wallet"/);
  });
});
