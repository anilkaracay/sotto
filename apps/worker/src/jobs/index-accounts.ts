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
// yet is read in the next pass. Mainnet is not indexed during the beta (D-01).
import { chainActivity, orgs, tokenAccounts, type Database } from "@sotto/db";
import { activityOf } from "@sotto/sdk/chain";
import { clusterFromGenesisHash, getClusterConfig } from "@sotto/sdk/cluster";
import type { SolanaRpc } from "@sotto/sdk/tx";
import { address, getBase64Encoder, type Address, type Signature } from "@solana/kit";
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
      for (const account of accounts) {
        const target = address(account.address);
        // New finalized transactions, newest first, back to the cursor.
        const found: { signature: Signature; slot: bigint; err: unknown }[] = [];
        let before: Signature | undefined;
        let complete = false;
        for (let page = 0; page < MAX_PAGES; page++) {
          const listed = await deps.rpc
            .getSignaturesForAddress(target, {
              commitment: "finalized",
              limit: PAGE,
              ...(account.indexedUntil ? { until: account.indexedUntil as Signature } : {}),
              ...(before ? { before } : {}),
            })
            .send();
          found.push(...listed);
          if (listed.length < PAGE) {
            complete = true;
            break;
          }
          before = listed.at(-1)?.signature;
        }
        if (!complete) {
          log("index_accounts_backlog", { tokenAccountId: account.id, read: found.length }, "warn");
        }
        let newest: Signature | null = null;
        for (const entry of [...found].reverse()) {
          if (entry.err !== null) {
            newest = entry.signature;
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
          if (!read) break;
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
          newest = entry.signature;
        }
        await deps.db
          .update(tokenAccounts)
          .set({
            ...(newest ? { indexedUntil: newest } : {}),
            indexedAt: deps.now?.() ?? new Date(),
          })
          .where(eq(tokenAccounts.id, account.id));
      }
      return { accounts: accounts.length, transactions, rows };
    },
  };
}
