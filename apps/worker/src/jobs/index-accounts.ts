// index-accounts (08 section 4, AC-05.3; step 2.5, plan move M4). Every 15 seconds, for the token
// accounts organizations' owners recorded for their organization on the worker's cluster (facts H6),
// the least recently read first: the finalized transactions newer than the account's cursor
// (getSignaturesForAddress), each read with getTransaction as base64 with
// maxSupportedTransactionVersion 1 (facts D2), so version 1 transactions are read too, and classified
// with @sotto/sdk/chain into public activity rows: who, when, which instruction, the other account, and
// only the amounts that are public onchain, a confidential deposit's or withdrawal's (ENGINEERING-RULES.md rule 4;
// the table's check refuses any other). Failed transactions move nothing and are skipped; a version 0
// transaction with lookup tables is skipped and logged (its accounts need the tables). Rows are
// inserted once (unique per instruction), so a pass that stops halfway is repeated safely; they are
// read oldest first and the cursor moves to the last one read, so a transaction listed but not returned
// yet is read in the next pass. The cursor keeps its slot: a node that no longer knows the cursor
// transaction (pruned from its ledger) refuses it as `until`, and the account is then listed back to
// that slot instead (step 2.6). An account whose reading fails is logged and the others are still read.
// Mainnet is not indexed during the beta (D-01).
import { chainActivity, orgs, tokenAccounts, type Database } from "@sotto/db";
import { activityOf } from "@sotto/sdk/chain";
import { clusterFromGenesisHash, getClusterConfig } from "@sotto/sdk/cluster";
import type { SolanaRpc } from "@sotto/sdk/tx";
import {
  address,
  getBase64Encoder,
  isSolanaError,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_FILTER_TRANSACTION_NOT_FOUND,
  type Address,
  type Signature,
} from "@solana/kit";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Job } from "./runner.ts";

export const INDEX_ACCOUNTS_INTERVAL_MS = 15_000;
/** Accounts read per pass, the least recently read first. */
const ACCOUNTS_PER_PASS = 20;
/** getSignaturesForAddress returns at most 1000 signatures per call. */
const PAGE = 1000;
/** Pages read per account and pass; more than 10 000 new transactions are logged as a backlog. */
const MAX_PAGES = 10;

type ClusterName = (typeof tokenAccounts.$inferSelect)["cluster"];

export type IndexAccountsDeps = { db: Database; rpc: SolanaRpc; now?: () => Date };

export function indexAccountsJob(deps: IndexAccountsDeps): Job {
  let cluster: { name: ClusterName; tokenWrap: Address } | "unavailable" | null = null;
  return {
    name: "index-accounts",
    intervalMs: INDEX_ACCOUNTS_INTERVAL_MS,
    run: async ({ log }) => {
      // An organization's own accounts: recorded by its owner, for it.
      const owned = () =>
        deps.db
          .select({
            id: tokenAccounts.id,
            orgId: orgs.id,
            address: tokenAccounts.address,
            indexedUntil: tokenAccounts.indexedUntil,
            indexedSlot: tokenAccounts.indexedSlot,
          })
          .from(tokenAccounts)
          .innerJoin(
            orgs,
            and(eq(orgs.id, tokenAccounts.orgId), eq(orgs.ownerUserId, tokenAccounts.userId)),
          );
      // Nothing recorded yet: no RPC call at all.
      const [any] = await owned().limit(1);
      if (!any) return { accounts: 0, transactions: 0, rows: 0 };
      if (cluster === null) {
        const found = clusterFromGenesisHash(await deps.rpc.getGenesisHash().send());
        const name: ClusterName = found === "other" ? "localnet" : found;
        const config = getClusterConfig(name);
        cluster = config.available ? { name, tokenWrap: config.programs.tokenWrap } : "unavailable";
      }
      if (cluster === "unavailable") return { accounts: 0, transactions: 0, rows: 0 };
      const { name, tokenWrap } = cluster;
      const accounts = await owned()
        .where(eq(tokenAccounts.cluster, name))
        .orderBy(sql`${tokenAccounts.indexedAt} asc nulls first`, asc(tokenAccounts.id))
        .limit(ACCOUNTS_PER_PASS);
      let transactions = 0;
      let rows = 0;
      type Listed = { signature: Signature; slot: bigint; err: unknown };
      /** Where an account's new transactions start: after a signature, or after or from a slot. */
      type From = { until: Signature } | { slot: bigint; inclusive: boolean } | null;
      /** New finalized transactions, newest first, back to `from`. */
      const listNew = async (
        target: Address,
        from: From,
      ): Promise<{ found: Listed[]; complete: boolean }> => {
        const found: Listed[] = [];
        let before: Signature | undefined;
        for (let page = 0; page < MAX_PAGES; page++) {
          const listed = await deps.rpc
            .getSignaturesForAddress(target, {
              commitment: "finalized",
              limit: PAGE,
              ...(from && "until" in from ? { until: from.until } : {}),
              ...(before ? { before } : {}),
            })
            .send();
          if (from && "slot" in from) {
            const newer = listed.filter((entry) =>
              from.inclusive ? entry.slot >= from.slot : entry.slot > from.slot,
            );
            found.push(...newer);
            if (newer.length < listed.length) return { found, complete: true };
          } else {
            found.push(...listed);
          }
          if (listed.length < PAGE) return { found, complete: true };
          before = listed.at(-1)?.signature;
        }
        return { found, complete: false };
      };
      for (const account of accounts) {
        const target = address(account.address);
        try {
          // A cursor without its signature: everything up to its slot, that slot included, is read.
          const cursor: From = account.indexedUntil
            ? { until: account.indexedUntil as Signature }
            : account.indexedSlot === null
              ? null
              : { slot: account.indexedSlot, inclusive: false };
          let pruned = false;
          let listing: { found: Listed[]; complete: boolean };
          try {
            listing = await listNew(target, cursor);
          } catch (error) {
            if (
              !(cursor && "until" in cursor) ||
              !isSolanaError(
                error,
                SOLANA_ERROR__JSON_RPC__SERVER_ERROR_FILTER_TRANSACTION_NOT_FOUND,
              )
            ) {
              throw error;
            }
            // The node pruned the cursor transaction (facts M5): back to its slot, included, since
            // another transaction of that slot may be unread; rows are inserted once.
            pruned = true;
            log(
              "index_accounts_cursor_pruned",
              { tokenAccountId: account.id, slot: account.indexedSlot?.toString() ?? null },
              "warn",
            );
            listing = await listNew(
              target,
              account.indexedSlot === null ? null : { slot: account.indexedSlot, inclusive: true },
            );
          }
          const { found, complete } = listing;
          if (!complete) {
            log(
              "index_accounts_backlog",
              { tokenAccountId: account.id, read: found.length },
              "warn",
            );
          }
          let newest: Listed | null = null;
          let stopped = false;
          for (const entry of [...found].reverse()) {
            if (entry.err !== null) {
              newest = entry;
              continue;
            }
            const read = await deps.rpc
              .getTransaction(entry.signature, {
                encoding: "base64",
                maxSupportedTransactionVersion: 1,
                commitment: "finalized",
              })
              .send();
            // Listed as finalized but not returned yet: the next pass starts from it.
            if (!read) {
              stopped = true;
              break;
            }
            transactions += 1;
            const result = activityOf({
              wire: new Uint8Array(getBase64Encoder().encode(read.transaction[0])),
              account: target,
              tokenWrapProgram: tokenWrap,
            });
            if (result.kind === "lookup_tables") {
              log(
                "index_accounts_lookup_tables_skipped",
                { tokenAccountId: account.id, transaction: entry.signature },
                "warn",
              );
            } else if (result.activity.length > 0) {
              const inserted = await deps.db
                .insert(chainActivity)
                .values(
                  result.activity.map((activity) => ({
                    orgId: account.orgId,
                    tokenAccount: account.address,
                    signature: entry.signature,
                    slot: read.slot,
                    blockTime:
                      read.blockTime === null ? null : new Date(Number(read.blockTime) * 1000),
                    instructionIndex: activity.instructionIndex,
                    instructionType: activity.type,
                    counterpartyAddress: activity.counterparty,
                    publicAmountBaseUnits: activity.publicAmount,
                  })),
                )
                .onConflictDoNothing()
                .returning({ id: chainActivity.id });
              rows += inserted.length;
            }
            newest = entry;
          }
          await deps.db
            .update(tokenAccounts)
            .set({
              ...(newest
                ? { indexedUntil: newest.signature, indexedSlot: newest.slot }
                : pruned && !stopped
                  ? // Nothing newer: the pruned signature is dropped and later passes list after its slot.
                    { indexedUntil: null }
                  : {}),
              indexedAt: deps.now?.() ?? new Date(),
            })
            .where(eq(tokenAccounts.id, account.id));
        } catch (error) {
          // One account's failure does not stop the others; it is read again next pass.
          log("index_accounts_account_failed", { tokenAccountId: account.id, error }, "error");
          await deps.db
            .update(tokenAccounts)
            .set({ indexedAt: deps.now?.() ?? new Date() })
            .where(eq(tokenAccounts.id, account.id));
        }
      }
      return { accounts: accounts.length, transactions, rows };
    },
  };
}
