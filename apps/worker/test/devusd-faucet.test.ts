// The devUSD faucet's worker side (step 4.3, D-29; founder, 2026-10-02), against a fresh test database
// and a stand-in RPC: on any ledger but devnet's it mints nothing and fails the open requests (the CI
// proof of the cluster guard), and with no open request it asks the network nothing.
import { faucetMints, orgs, users } from "@sotto/db";
import { createTestDatabase, type TestDatabase } from "@sotto/db/testing";
import { GENESIS_HASHES } from "@sotto/sdk/cluster";
import type { SolanaRpc } from "@sotto/sdk/tx";
import { generateKeyPairSigner, getAddressDecoder } from "@solana/kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { devusdFaucetJob } from "../src/jobs/devusd-faucet.ts";

const randomAddress = () => getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));

let database: TestDatabase;
let orgId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  const [owner] = await database.db
    .insert(users)
    .values({ wallet: randomAddress() })
    .returning({ id: users.id });
  if (!owner) throw new Error("user not inserted");
  const [org] = await database.db
    .insert(orgs)
    .values({
      displayName: "Northwind",
      legalName: "Northwind Labs Demo Ltd",
      country: "GB",
      registrationNo: "0001",
      website: "https://northwind.example",
      contactEmail: "ops@northwind.example",
      ownerUserId: owner.id,
      status: "active",
      asset: "devusd",
    })
    .returning({ id: orgs.id });
  if (!org) throw new Error("org not inserted");
  orgId = org.id;
});

afterAll(async () => {
  await database?.drop();
});

/** An RPC that answers the genesis hash and records every other call it was asked. */
function ledger(genesisHash: string) {
  const asked: string[] = [];
  const rpc = new Proxy(
    {},
    {
      get: (_, method: string) => () => ({
        send: async () => {
          asked.push(method);
          if (method === "getGenesisHash") return genesisHash;
          throw new Error(`unexpected ${method}`);
        },
      }),
    },
  ) as unknown as SolanaRpc;
  return { rpc, asked };
}

describe("devusd-faucet job", () => {
  it("asks the network nothing while no request is open", async () => {
    const { rpc, asked } = ledger(GENESIS_HASHES.devnet);
    const job = devusdFaucetJob({
      db: database.db,
      rpc,
      authority: await generateKeyPairSigner(),
      mint: randomAddress(),
    });
    expect(await job.run({ signal: new AbortController().signal, log: () => {} })).toEqual({
      minted: 0,
      sent: 0,
      failed: 0,
    });
    expect(asked).toEqual([]);
  });

  it("mints nothing on any ledger but devnet's and fails the open requests", async () => {
    for (const genesis of [
      GENESIS_HASHES.mainnet,
      "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
    ]) {
      const [request] = await database.db
        .insert(faucetMints)
        .values({ orgId, wallet: randomAddress(), amountBaseUnits: 1_000_000n })
        .returning();
      const { rpc, asked } = ledger(genesis);
      const logged: string[] = [];
      const job = devusdFaucetJob({
        db: database.db,
        rpc,
        authority: await generateKeyPairSigner(),
        mint: randomAddress(),
      });
      const result = await job.run({
        signal: new AbortController().signal,
        log: (event) => logged.push(event),
      });
      expect(result).toEqual({ minted: 0, sent: 0, failed: 1 });
      // Only the genesis hash was read: no mint was read, built, signed or sent.
      expect(asked).toEqual(["getGenesisHash"]);
      expect(logged).toEqual(["faucet_refused"]);
      const rows = await database.db.select().from(faucetMints);
      expect(rows.find((row) => row.id === request?.id)).toMatchObject({
        status: "failed",
        errorCode: "wrong_cluster",
        signature: null,
      });
    }
  });
});
