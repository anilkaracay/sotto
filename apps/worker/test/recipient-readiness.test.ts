// The recipient-readiness job (08 section 4, AC-07.2; step 1.8) against a fresh test database and an RPC
// stand in: recipients that are not ready get the readiness their wUSDC account shows, ready ones are
// not read again, and nothing is read while every recipient is ready.
import { orgs, recipients, users } from "@sotto/db";
import { createTestDatabase, type TestDatabase } from "@sotto/db/testing";
import { getClusterConfig, GENESIS_HASHES, type AvailableClusterConfig } from "@sotto/sdk/cluster";
import { associatedTokenAccount } from "@sotto/sdk/confidential/public";
import { confidentialTokenAccount, encodeToken2022Account } from "@sotto/sdk/testing";
import type { SolanaRpc } from "@sotto/sdk/tx";
import { address, getAddressDecoder, getBase64Decoder, type Address } from "@solana/kit";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recipientReadinessJob } from "../src/jobs/recipient-readiness.ts";

const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const devnet = getClusterConfig("devnet") as AvailableClusterConfig;
const WUSDC = devnet.wrappedUsdcMint as Address;
const ELGAMAL = address("BxMVLbjVntF9DJtDjfpQLrgw4hopedMgNkZZKGcVkZp6");
const randomAddress = () => getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database?.drop();
});

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

const context = (lines: string[] = []) => ({
  signal: new AbortController().signal,
  log: (event: string) => void lines.push(event),
});

describe("recipient-readiness job", () => {
  it("AC-07.2 stores the readiness each recipient's wUSDC account shows, and skips ready recipients", async () => {
    const [owner] = await database.db
      .insert(users)
      .values({ wallet: randomAddress() })
      .returning({ id: users.id });
    if (!owner) throw new Error("user not inserted");
    const [org] = await database.db
      .insert(orgs)
      .values({
        displayName: "Northwind",
        legalName: "Northwind Labs Ltd",
        country: "TR",
        registrationNo: "0001",
        website: "https://northwind.example",
        contactEmail: "ops@northwind.example",
        ownerUserId: owner.id,
        status: "active",
      })
      .returning({ id: orgs.id });
    if (!org) throw new Error("org not inserted");
    const chain = new Map<string, Uint8Array>();
    const wallets = {
      ready: randomAddress(),
      plain: randomAddress(),
      none: randomAddress(),
      already: randomAddress(),
    };
    chain.set(
      await associatedTokenAccount(wallets.ready, WUSDC),
      encodeToken2022Account(
        confidentialTokenAccount({ owner: wallets.ready, mint: WUSDC, elgamalPubkey: ELGAMAL }),
      ),
    );
    chain.set(
      await associatedTokenAccount(wallets.plain, WUSDC),
      encodeToken2022Account(
        confidentialTokenAccount({
          owner: wallets.plain,
          mint: WUSDC,
          elgamalPubkey: ELGAMAL,
          confidential: false,
        }),
      ),
    );
    const { rpc, calls } = fakeRpc(chain);
    const job = recipientReadinessJob({ db: database.db, rpc, localnetUsdcMint: null });
    // Nothing to check yet: no RPC call.
    expect(await job.run(context())).toEqual({ checked: 0, ready: 0 });
    expect(calls).toEqual({ genesis: 0, multiple: 0 });

    for (const [name, wallet] of Object.entries(wallets)) {
      await database.db.insert(recipients).values({
        orgId: org.id,
        displayName: name,
        wallet,
        readiness: name === "already" ? "ready" : "no_account",
      });
    }
    expect(await job.run(context())).toEqual({ checked: 3, ready: 1 });
    const readiness = async (wallet: string) =>
      (
        await database.db
          .select({ readiness: recipients.readiness, checkedAt: recipients.readinessCheckedAt })
          .from(recipients)
          .where(eq(recipients.wallet, wallet))
      )[0];
    expect(await readiness(wallets.ready)).toMatchObject({ readiness: "ready" });
    expect(await readiness(wallets.plain)).toMatchObject({ readiness: "not_configured" });
    expect(await readiness(wallets.none)).toMatchObject({ readiness: "no_account" });
    expect((await readiness(wallets.none))?.checkedAt).toBeInstanceOf(Date);
    expect((await readiness(wallets.already))?.checkedAt).toBeNull();

    // The next pass reads only the two that are still not ready, and the cluster once.
    expect(await job.run(context())).toEqual({ checked: 2, ready: 0 });
    expect(calls.genesis).toBe(1);
  });

  it("waits and logs on a local ledger without LOCALNET_USDC_MINT", async () => {
    const localRpc = {
      getGenesisHash: () => ({ send: async () => "LocalLedgerGenesis1111111111111111111111111" }),
    } as unknown as SolanaRpc;
    const lines: string[] = [];
    const job = recipientReadinessJob({ db: database.db, rpc: localRpc, localnetUsdcMint: null });
    expect(await job.run(context(lines))).toEqual({ checked: 0, ready: 0 });
    expect(lines).toContain("recipient_readiness_no_mint");
  });
});
