// The pending-credits job (08 section 4, AC-04.3) against a fresh test database and an RPC stand in that
// serves encoded Token-2022 accounts: accounts at or above 80 percent of their credit counter maximum
// are flagged, flags below it are cleared, other clusters and unreadable accounts are left alone.
import { tokenAccounts, users } from "@sotto/db";
import { createTestDatabase, type TestDatabase } from "@sotto/db/testing";
import { GENESIS_HASHES } from "@sotto/sdk/cluster";
import { confidentialTokenAccount, encodeToken2022Account } from "@sotto/sdk/testing";
import type { SolanaRpc } from "@sotto/sdk/tx";
import { address, getAddressDecoder, getBase64Decoder, type Address } from "@solana/kit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pendingCreditsJob } from "../src/jobs/pending-credits.ts";

const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const MINT = address("AhJfP4JJBaHWRtXRiaScZUC7SMm4RqUPSb3g9H5RT8Bd");
const ELGAMAL = address("BxMVLbjVntF9DJtDjfpQLrgw4hopedMgNkZZKGcVkZp6");
const randomAddress = () => getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database?.drop();
});

/** Serves the given accounts (missing ones as null) and counts calls. */
function fakeRpc(accounts: Map<string, Uint8Array>) {
  const calls = { genesis: 0, multiple: 0 };
  const rpc = {
    getGenesisHash: () => ({
      send: async () => {
        calls.genesis += 1;
        return GENESIS_HASHES.devnet;
      },
    }),
    getMultipleAccounts: (addresses: Address[]) => ({
      send: async () => {
        calls.multiple += 1;
        return {
          context: { slot: 1n },
          value: addresses.map((at) => {
            const data = accounts.get(at);
            return data
              ? {
                  data: [getBase64Decoder().decode(data), "base64"],
                  executable: false,
                  lamports: 2_039_280n,
                  owner: TOKEN_2022,
                  space: BigInt(data.length),
                  rentEpoch: 0n,
                }
              : null;
          }),
        };
      },
    }),
  };
  return { rpc: rpc as unknown as SolanaRpc, calls };
}

const context = (lines: string[]) => ({
  signal: new AbortController().signal,
  log: (event: string) => void lines.push(event),
});

describe("pending-credits job", () => {
  it("makes no RPC call while no token account is recorded", async () => {
    const { rpc, calls } = fakeRpc(new Map());
    const result = await pendingCreditsJob({ db: database.db, rpc }).run(context([]));
    expect(result).toEqual({ checked: 0, flagged: 0, cleared: 0 });
    expect(calls).toEqual({ genesis: 0, multiple: 0 });
  });

  it("AC-04.3 flags accounts at or above 80 percent of the credit counter maximum and clears the rest", async () => {
    const owner = randomAddress();
    const [user] = await database.db
      .insert(users)
      .values({ wallet: owner })
      .returning({ id: users.id });
    if (!user) throw new Error("user not inserted");
    const chain = new Map<string, Uint8Array>();
    const account = (credits: bigint) => {
      const at = randomAddress();
      chain.set(
        at,
        encodeToken2022Account(
          confidentialTokenAccount({
            owner: address(owner),
            mint: MINT,
            elgamalPubkey: ELGAMAL,
            pendingBalanceCreditCounter: credits,
            maximumPendingBalanceCreditCounter: 5n,
          }),
        ),
      );
      return at;
    };
    const earlier = new Date("2026-09-27T10:00:00.000Z");
    const rows = {
      atFour: account(4n),
      atThree: account(3n),
      flaggedBefore: account(0n),
      missing: randomAddress(),
      otherCluster: account(5n),
    };
    const insert = (at: string, cluster: "devnet" | "localnet", applyFlaggedAt: Date | null) =>
      database.db.insert(tokenAccounts).values({
        userId: user.id,
        cluster,
        address: at,
        mint: MINT,
        keyScheme: "standard_v1",
        applyFlaggedAt,
      });
    await insert(rows.atFour, "devnet", null);
    await insert(rows.atThree, "devnet", null);
    await insert(rows.flaggedBefore, "devnet", earlier);
    await insert(rows.missing, "devnet", earlier);
    await insert(rows.otherCluster, "localnet", null);

    const now = new Date("2026-09-27T12:00:00.000Z");
    const { rpc, calls } = fakeRpc(chain);
    const lines: string[] = [];
    const job = pendingCreditsJob({ db: database.db, rpc, now: () => now });
    expect(await job.run(context(lines))).toEqual({
      cluster: "devnet",
      checked: 4,
      flagged: 1,
      cleared: 1,
    });
    const flag = async (at: string) =>
      (
        await database.db
          .select({ applyFlaggedAt: tokenAccounts.applyFlaggedAt })
          .from(tokenAccounts)
          .where(eq(tokenAccounts.address, at))
      )[0]?.applyFlaggedAt ?? null;
    expect(await flag(rows.atFour)).toEqual(now);
    expect(await flag(rows.atThree)).toBeNull();
    expect(await flag(rows.flaggedBefore)).toBeNull();
    // An account that no longer reads as configured keeps its state and is logged.
    expect(await flag(rows.missing)).toEqual(earlier);
    expect(lines).toContain("pending_credits_unreadable");
    // The localnet row is not this worker's cluster.
    expect(await flag(rows.otherCluster)).toBeNull();

    // A second pass changes nothing; the cluster is read once.
    expect(await job.run(context([]))).toMatchObject({ flagged: 0, cleared: 0 });
    expect(calls.genesis).toBe(1);
  });
});
