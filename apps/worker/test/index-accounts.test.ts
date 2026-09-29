// The index-accounts job (08 section 4, AC-05.3; step 2.5) against a fresh test database and an RPC
// stand in that lists signatures and serves transactions built here: no RPC call while no org account
// is recorded; the org owner's account is read oldest first, a failed transaction is skipped without
// being fetched, a version 0 transaction with lookup tables is logged and skipped, only the deposits'
// public amounts are stored; a transaction listed but not returned yet is read by the next pass, which
// starts from the last one read; a cursor the node has pruned is refused as `until` and the account is
// listed back to the cursor's slot instead, and after that slot alone once nothing newer is found; an account whose reading fails does not stop the others;
// mainnet is not read during the beta (D-01). Real transactions of
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
  getSolanaErrorFromJsonRpcError,
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

/**
 * Lists `history` newest first, back to `until`, a page of `limit` before `before`; serves each
 * transaction's wire, or none. Slots below `ledger.first` are pruned, as a node's cleanup does: they
 * are not listed, and a signature of theirs as `until` is refused (JSON-RPC error -32020, facts M5).
 * An address in `failing` fails; with `only`, other addresses have no history.
 */
function fakeRpc(
  history: Listed[],
  genesis: string = GENESIS_HASHES.devnet,
  nodes: { ledger?: { first: bigint }; failing?: Set<string>; only?: string } = {},
) {
  const calls = {
    genesis: 0,
    signatures: 0,
    transactions: [] as string[],
    listings: [] as { target: string; until: string | null }[],
  };
  const rpc = {
    getGenesisHash: () => ({
      send: async () => {
        calls.genesis += 1;
        return genesis;
      },
    }),
    getSignaturesForAddress: (
      target: Address,
      options: { until?: string; before?: string; limit?: number },
    ) => ({
      send: async () => {
        calls.signatures += 1;
        calls.listings.push({ target, until: options.until ?? null });
        if (nodes.failing?.has(target)) throw new Error("node unavailable");
        if (nodes.only && target !== nodes.only) return [];
        const first = nodes.ledger?.first ?? 0n;
        let newestFirst = [...history].reverse().filter((entry) => entry.slot >= first);
        if (options.until && !newestFirst.some((e) => e.signature === options.until)) {
          throw getSolanaErrorFromJsonRpcError({
            code: -32020,
            message: `Transaction ${options.until} not found`,
          });
        }
        if (options.before) {
          newestFirst = newestFirst.slice(
            newestFirst.findIndex((e) => e.signature === options.before) + 1,
          );
        }
        const stop = options.until
          ? newestFirst.findIndex((e) => e.signature === options.until)
          : -1;
        return (stop === -1 ? newestFirst : newestFirst.slice(0, stop))
          .slice(0, options.limit ?? 1000)
          .map((entry) => ({
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
    expect(calls).toEqual({ genesis: 0, signatures: 0, transactions: [], listings: [] });
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

  it("lists a pruned cursor's account back to the cursor's slot, then after that slot alone", async () => {
    const { owner, account, orgId } = await orgAccount();
    const deposit = (slot: bigint, amount: bigint): Listed => ({
      signature: randomSignature(),
      slot,
      err: null,
      wire: depositWire(owner, account, amount),
    });
    const [old, cursor, next, later] = [
      deposit(20n, 1_000_000n),
      deposit(21n, 2_000_000n),
      deposit(22n, 4_000_000n),
      deposit(23n, 5_000_000n),
    ];
    const history: Listed[] = [old, cursor];
    const ledger = { first: 0n };
    const { rpc, calls } = fakeRpc(history, GENESIS_HASHES.devnet, { ledger, only: account });
    const job = indexAccountsJob({ db: database.db, rpc });
    const stored = async () => {
      const [row] = await database.db
        .select({ until: tokenAccounts.indexedUntil, slot: tokenAccounts.indexedSlot })
        .from(tokenAccounts)
        .where(eq(tokenAccounts.address, account));
      return row;
    };
    const pass = async () => {
      const lines: string[] = [];
      const result = await job.run(context(lines));
      expect(lines).not.toContain("index_accounts_account_failed");
      return {
        ...result,
        pruned: lines.filter((l) => l === "index_accounts_cursor_pruned").length,
      };
    };
    expect(await pass()).toMatchObject({ transactions: 2, rows: 2, pruned: 0 });
    expect(await stored()).toEqual({ until: cursor.signature, slot: 21n });

    // The node prunes the cursor's slot; a newer transaction arrives and is read from the slot.
    ledger.first = 22n;
    history.push(next);
    expect(await pass()).toMatchObject({ transactions: 1, rows: 1, pruned: 1 });
    expect(await stored()).toEqual({ until: next.signature, slot: 22n });

    // Pruned again with nothing newer: the signature is dropped once, then listing goes by the slot.
    ledger.first = 23n;
    expect(await pass()).toMatchObject({ transactions: 0, rows: 0, pruned: 1 });
    expect(await stored()).toEqual({ until: null, slot: 22n });
    const listings = calls.listings.length;
    expect(await pass()).toMatchObject({ transactions: 0, rows: 0, pruned: 0 });
    expect(calls.listings.slice(listings).filter((l) => l.target === account)).toEqual([
      { target: account, until: null },
    ]);
    history.push(later);
    expect(await pass()).toMatchObject({ transactions: 1, rows: 1, pruned: 0 });
    expect(await stored()).toEqual({ until: later.signature, slot: 23n });

    const amounts = await database.db
      .select({ amount: chainActivity.publicAmountBaseUnits })
      .from(chainActivity)
      .where(eq(chainActivity.orgId, orgId))
      .orderBy(asc(chainActivity.publicAmountBaseUnits));
    expect(amounts.map((row) => row.amount)).toEqual([
      1_000_000n,
      2_000_000n,
      4_000_000n,
      5_000_000n,
    ]);
  });

  it("goes on with the other accounts when one account's reading fails", async () => {
    const broken = await orgAccount();
    const working = await orgAccount();
    const history: Listed[] = [
      {
        signature: randomSignature(),
        slot: 30n,
        err: null,
        wire: depositWire(working.owner, working.account, 7_000_000n),
      },
    ];
    const { rpc } = fakeRpc(history, GENESIS_HASHES.devnet, {
      failing: new Set([broken.account]),
      only: working.account,
    });
    const lines: string[] = [];
    await indexAccountsJob({ db: database.db, rpc }).run(context(lines));
    expect(lines.filter((line) => line === "index_accounts_account_failed")).toHaveLength(1);
    const rows = await database.db
      .select({ amount: chainActivity.publicAmountBaseUnits })
      .from(chainActivity)
      .where(eq(chainActivity.orgId, working.orgId));
    expect(rows.map((row) => row.amount)).toEqual([7_000_000n]);
    // The failing account was still marked read, so it does not hold the queue's head.
    const [marked] = await database.db
      .select({ at: tokenAccounts.indexedAt, until: tokenAccounts.indexedUntil })
      .from(tokenAccounts)
      .where(eq(tokenAccounts.address, broken.account));
    expect(marked?.at).not.toBeNull();
    expect(marked?.until).toBeNull();
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
