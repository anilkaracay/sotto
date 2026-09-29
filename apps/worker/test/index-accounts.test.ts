// The index-accounts job (08 section 4, AC-05.3; step 2.5) against a fresh test database and an RPC
// stand in that lists signatures and serves transactions built here: no RPC call while no org account
// is recorded; the org owner's account is read oldest first, a failed transaction is skipped without
// being fetched, a version 0 transaction with lookup tables is logged and skipped, only the deposits'
// public amounts are stored; a transaction listed but not returned yet is read by the next pass, which
// starts from the last one read; mainnet is not read during the beta (D-01). Real transactions of
// every flow, version 1 included, are read in index-accounts-localnet.test.ts.
import { chainActivity, orgs, tokenAccounts, users } from "@sotto/db";
import { createTestDatabase, type TestDatabase } from "@sotto/db/testing";
import { GENESIS_HASHES } from "@sotto/sdk/cluster";
import { confidentialDepositInstruction } from "@sotto/sdk/confidential/public";
import type { SolanaRpc } from "@sotto/sdk/tx";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createNoopSigner,
  createTransactionMessage,
  getAddressDecoder,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
} from "@solana/kit";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexAccountsJob } from "../src/jobs/index-accounts.ts";

const MINT = address("EnGvQ7aUW3r1pE1xfHXURfwHpnfhUhEtYChX8hfextDT");
const TABLE = address("AaP2561CRozEb9ZxW3WPp5PjoqREN6HCc8D2kJFLbqzq");
const LIFETIME = {
  blockhash: "5ud3kY17PCk6srqcevVnmPk22xPBXHzVvX3fzTaGp4Yx" as Blockhash,
  lastValidBlockHeight: 100n,
};
const randomAddress = () => getAddressDecoder().decode(crypto.getRandomValues(new Uint8Array(32)));
const randomSignature = () => getBase58Decoder().decode(crypto.getRandomValues(new Uint8Array(64)));

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
});

afterAll(async () => {
  await database?.drop();
});

/** A version 0 deposit of `amount` into `account`, optionally loading `other` from a lookup table. */
function depositWire(owner: Address, account: Address, amount: bigint, other?: Address): string {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(owner, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(LIFETIME, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          confidentialDepositInstruction({
            token: account,
            mint: other ?? MINT,
            owner: createNoopSigner(owner),
            amount,
            decimals: 6,
          }),
        ],
        m,
      ),
  );
  const compiled = other
    ? compileTransaction(
        compressTransactionMessageUsingAddressLookupTables(message, { [TABLE]: [other] }),
      )
    : compileTransaction(message);
  return getBase64EncodedWireTransaction(compiled);
}

type Listed = { signature: string; slot: bigint; err: unknown; wire: string | null };

/** Lists `history` newest first, back to `until`; serves each transaction's wire, or none. */
function fakeRpc(history: Listed[], genesis: string = GENESIS_HASHES.devnet) {
  const calls = { genesis: 0, signatures: 0, transactions: [] as string[] };
  const rpc = {
    getGenesisHash: () => ({
      send: async () => {
        calls.genesis += 1;
        return genesis;
      },
    }),
    getSignaturesForAddress: (_: Address, options: { until?: string }) => ({
      send: async () => {
        calls.signatures += 1;
        const newestFirst = [...history].reverse();
        const stop = options.until
          ? newestFirst.findIndex((e) => e.signature === options.until)
          : -1;
        return (stop === -1 ? newestFirst : newestFirst.slice(0, stop)).map((entry) => ({
          signature: entry.signature,
          slot: entry.slot,
          err: entry.err,
          blockTime: 1_790_000_000n + entry.slot,
          confirmationStatus: "finalized",
          memo: null,
        }));
      },
    }),
    getTransaction: (signature: string) => ({
      send: async () => {
        calls.transactions.push(signature);
        const entry = history.find((e) => e.signature === signature);
        if (!entry?.wire) return null;
        return {
          slot: entry.slot,
          blockTime: 1_790_000_000n + entry.slot,
          version: 0,
          meta: { err: null },
          transaction: [entry.wire, "base64"],
        };
      },
    }),
  };
  return { rpc: rpc as unknown as SolanaRpc, calls };
}

function context(lines: string[]) {
  return { signal: new AbortController().signal, log: (event: string) => void lines.push(event) };
}

async function orgAccount() {
  const owner = randomAddress();
  const [user] = await database.db
    .insert(users)
    .values({ wallet: owner })
    .returning({ id: users.id });
  if (!user) throw new Error("user not inserted");
  const [org] = await database.db
    .insert(orgs)
    .values({
      displayName: "Northwind",
      legalName: "Northwind Labs Ltd",
      country: "TR",
      registrationNo: "0001",
      website: "https://northwind.example",
      contactEmail: "ops@northwind.example",
      ownerUserId: user.id,
      status: "active",
    })
    .returning({ id: orgs.id });
  if (!org) throw new Error("org not inserted");
  const account = randomAddress();
  await database.db.insert(tokenAccounts).values({
    userId: user.id,
    orgId: org.id,
    cluster: "devnet",
    address: account,
    mint: MINT,
    keyScheme: "standard_v1",
  });
  return { owner, account, orgId: org.id };
}

describe("index-accounts job", () => {
  it("makes no RPC call while no org account is recorded", async () => {
    const { rpc, calls } = fakeRpc([]);
    expect(await indexAccountsJob({ db: database.db, rpc }).run(context([]))).toEqual({
      accounts: 0,
      transactions: 0,
      rows: 0,
    });
    expect(calls).toEqual({ genesis: 0, signatures: 0, transactions: [] });
  });

  it("AC-05.3 reads the account oldest first, skips failed and lookup table transactions, keeps only public amounts, and starts the next pass from the last one read", async () => {
    const { owner, account, orgId } = await orgAccount();
    const first: Listed = {
      signature: randomSignature(),
      slot: 10n,
      err: null,
      wire: depositWire(owner, account, 20_000_000n),
    };
    const failed: Listed = { signature: randomSignature(), slot: 11n, err: { x: 1 }, wire: null };
    const tables: Listed = {
      signature: randomSignature(),
      slot: 12n,
      err: null,
      wire: depositWire(owner, account, 1n, randomAddress()),
    };
    const pending: Listed = {
      signature: randomSignature(),
      slot: 13n,
      err: null,
      wire: null,
    };
    const history = [first, failed, tables, pending];
    const { rpc, calls } = fakeRpc(history);
    const lines: string[] = [];
    const job = indexAccountsJob({ db: database.db, rpc });
    expect(await job.run(context(lines))).toEqual({ accounts: 1, transactions: 2, rows: 1 });
    // The failed transaction is not fetched; the pending one is, and is not returned yet.
    expect(calls.transactions).toEqual([first.signature, tables.signature, pending.signature]);
    expect(lines).toContain("index_accounts_lookup_tables_skipped");
    const rows = () =>
      database.db
        .select()
        .from(chainActivity)
        .where(eq(chainActivity.orgId, orgId))
        .orderBy(asc(chainActivity.slot));
    expect((await rows()).map((row) => [row.instructionType, row.publicAmountBaseUnits])).toEqual([
      ["deposit", 20_000_000n],
    ]);
    const [cursor] = await database.db
      .select({ until: tokenAccounts.indexedUntil })
      .from(tokenAccounts)
      .where(eq(tokenAccounts.address, account));
    expect(cursor?.until).toBe(tables.signature);

    // The next pass reads the pending transaction once it is returned.
    pending.wire = depositWire(owner, account, 5_000_000n);
    expect(await job.run(context([]))).toEqual({ accounts: 1, transactions: 1, rows: 1 });
    expect((await rows()).map((row) => [row.slot, row.publicAmountBaseUnits])).toEqual([
      [10n, 20_000_000n],
      [13n, 5_000_000n],
    ]);
    expect(await job.run(context([]))).toEqual({ accounts: 1, transactions: 0, rows: 0 });
  });

  it("does not read mainnet during the beta (D-01)", async () => {
    const { rpc, calls } = fakeRpc([], GENESIS_HASHES.mainnet);
    expect(await indexAccountsJob({ db: database.db, rpc }).run(context([]))).toEqual({
      accounts: 0,
      transactions: 0,
      rows: 0,
    });
    expect(calls.signatures).toBe(0);
  });
});
