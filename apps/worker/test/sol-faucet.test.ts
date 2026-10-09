// The faucet's devnet SOL, worker side (step 4.6, D-31), against a fresh test database and a stand-in
// RPC: with no open request it asks the network nothing; on any ledger but devnet's it sends nothing
// and fails the open requests; and it never takes its wallet below the reserve.
import { solGrants, users } from "@sotto/db";
import { createTestDatabase, type TestDatabase } from "@sotto/db/testing";
import { GENESIS_HASHES } from "@sotto/sdk/cluster";
import type { SolanaRpc } from "@sotto/sdk/tx";
import { generateKeyPairSigner, getAddressDecoder } from "@solana/kit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SOL_FAUCET_RESERVE_LAMPORTS, solFaucetJob } from "../src/jobs/sol-faucet.ts";

const randomAddress = () => getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));
const GRANT = 50_000_000n;

let database: TestDatabase;
let userId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  const [user] = await database.db
    .insert(users)
    .values({ wallet: randomAddress() })
    .returning({ id: users.id });
  if (!user) throw new Error("user not inserted");
  userId = user.id;
});

afterAll(async () => {
  await database?.drop();
});

/** An RPC that answers the genesis hash and the payer's balance, and records every call. */
function ledger(genesisHash: string, balance?: bigint) {
  const asked: string[] = [];
  const rpc = new Proxy(
    {},
    {
      get: (_, method: string) => () => ({
        send: async () => {
          asked.push(method);
          if (method === "getGenesisHash") return genesisHash;
          if (method === "getBalance" && balance !== undefined) return { value: balance };
          throw new Error(`unexpected ${method}`);
        },
      }),
    },
  ) as unknown as SolanaRpc;
  return { rpc, asked };
}

async function request() {
  const [row] = await database.db
    .insert(solGrants)
    .values({ userId, wallet: randomAddress(), lamports: GRANT })
    .returning();
  if (!row) throw new Error("grant not inserted");
  return row;
}

const stored = async (id: string) =>
  (await database.db.select().from(solGrants).where(eq(solGrants.id, id)))[0];

describe("sol-faucet job", () => {
  it("asks the network nothing while no request is open", async () => {
    const { rpc, asked } = ledger(GENESIS_HASHES.devnet);
    const job = solFaucetJob({ db: database.db, rpc, payer: await generateKeyPairSigner() });
    expect(await job.run({ signal: new AbortController().signal, log: () => {} })).toEqual({
      paid: 0,
      sent: 0,
      failed: 0,
    });
    expect(asked).toEqual([]);
  });

  it("sends nothing on any ledger but devnet's and fails the open requests", async () => {
    for (const genesis of [
      GENESIS_HASHES.mainnet,
      "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
    ]) {
      const grant = await request();
      const { rpc, asked } = ledger(genesis, 10_000_000_000n);
      const logged: string[] = [];
      const job = solFaucetJob({ db: database.db, rpc, payer: await generateKeyPairSigner() });
      const result = await job.run({
        signal: new AbortController().signal,
        log: (event) => logged.push(event),
      });
      expect(result).toEqual({ paid: 0, sent: 0, failed: 1 });
      // Only the genesis hash was read: no balance was read and nothing was built, signed or sent.
      expect(asked).toEqual(["getGenesisHash"]);
      expect(logged).toEqual(["sol_faucet_refused"]);
      expect(await stored(grant.id)).toMatchObject({
        status: "failed",
        errorCode: "wrong_cluster",
        signature: null,
      });
    }
  });

  it("keeps the reserve: a grant its wallet cannot afford above it fails and is not sent", async () => {
    const grant = await request();
    const { rpc, asked } = ledger(GENESIS_HASHES.devnet, GRANT + SOL_FAUCET_RESERVE_LAMPORTS - 1n);
    const logged: string[] = [];
    const job = solFaucetJob({ db: database.db, rpc, payer: await generateKeyPairSigner() });
    const result = await job.run({
      signal: new AbortController().signal,
      log: (event) => logged.push(event),
    });
    expect(result).toEqual({ paid: 0, sent: 0, failed: 1 });
    expect(asked).toEqual(["getGenesisHash", "getBalance"]);
    expect(logged).toEqual(["sol_faucet_low"]);
    expect(await stored(grant.id)).toMatchObject({
      status: "failed",
      errorCode: "faucet_low",
      signature: null,
    });
  });
});
