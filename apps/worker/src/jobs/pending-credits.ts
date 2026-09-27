// pending-credits (08 section 4, AC-04.3). Every 60 seconds, reads the pending balance credit counter of
// each recorded wUSDC account on the worker's cluster (public fields of the confidential extension, no
// keys) and flags an account while its counter is at or above 80 percent of its maximum; the app then
// prompts the owner to apply the pending balance on the next unlock. Below 80 percent the flag is
// cleared. The flag only prompts: nothing is applied without the owner. The cluster comes from the
// RPC's genesis hash (facts H6): devnet, mainnet, or a local ledger.
import { tokenAccounts, type Database } from "@sotto/db";
import { clusterFromGenesisHash } from "@sotto/sdk/cluster";
import { creditCounterNeedsApply, tokenAccountState } from "@sotto/sdk/confidential/public";
import type { SolanaRpc } from "@sotto/sdk/tx";
import { address, fetchEncodedAccounts } from "@solana/kit";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import type { Job } from "./runner.ts";

export const PENDING_CREDITS_INTERVAL_MS = 60_000;
/** getMultipleAccounts reads at most 100 accounts per call. */
const BATCH = 100;

type ClusterName = (typeof tokenAccounts.$inferSelect)["cluster"];

export type PendingCreditsDeps = { db: Database; rpc: SolanaRpc; now?: () => Date };

export function pendingCreditsJob(deps: PendingCreditsDeps): Job {
  let cluster: ClusterName | null = null;
  return {
    name: "pending-credits",
    intervalMs: PENDING_CREDITS_INTERVAL_MS,
    run: async ({ log }) => {
      // Nothing recorded yet: no RPC call at all.
      const [any] = await deps.db.select({ id: tokenAccounts.id }).from(tokenAccounts).limit(1);
      if (!any) return { checked: 0, flagged: 0, cleared: 0 };
      if (!cluster) {
        const found = clusterFromGenesisHash(await deps.rpc.getGenesisHash().send());
        cluster = found === "other" ? "localnet" : found;
      }
      let checked = 0;
      let flagged = 0;
      let cleared = 0;
      let after: string | null = null;
      for (;;) {
        const rows: { id: string; address: string; applyFlaggedAt: Date | null }[] = await deps.db
          .select({
            id: tokenAccounts.id,
            address: tokenAccounts.address,
            applyFlaggedAt: tokenAccounts.applyFlaggedAt,
          })
          .from(tokenAccounts)
          .where(
            after === null
              ? eq(tokenAccounts.cluster, cluster)
              : and(eq(tokenAccounts.cluster, cluster), gt(tokenAccounts.id, after)),
          )
          .orderBy(asc(tokenAccounts.id))
          .limit(BATCH);
        if (rows.length === 0) break;
        const accounts = await fetchEncodedAccounts(
          deps.rpc,
          rows.map((row) => address(row.address)),
          { commitment: "confirmed" },
        );
        const toFlag: string[] = [];
        const toClear: string[] = [];
        rows.forEach((row, index) => {
          const account = accounts[index];
          let state;
          try {
            state = account ? tokenAccountState(account) : null;
          } catch {
            state = null;
          }
          if (state?.status !== "present" || !state.confidential) {
            log("pending_credits_unreadable", { tokenAccountId: row.id }, "warn");
            return;
          }
          const needsApply = creditCounterNeedsApply(state.confidential);
          if (needsApply && row.applyFlaggedAt === null) toFlag.push(row.id);
          if (!needsApply && row.applyFlaggedAt !== null) toClear.push(row.id);
        });
        if (toFlag.length > 0) {
          await deps.db
            .update(tokenAccounts)
            .set({ applyFlaggedAt: deps.now?.() ?? new Date() })
            .where(inArray(tokenAccounts.id, toFlag));
        }
        if (toClear.length > 0) {
          await deps.db
            .update(tokenAccounts)
            .set({ applyFlaggedAt: null })
            .where(inArray(tokenAccounts.id, toClear));
        }
        checked += rows.length;
        flagged += toFlag.length;
        cleared += toClear.length;
        after = rows[rows.length - 1]?.id ?? null;
        if (rows.length < BATCH) break;
      }
      return { cluster, checked, flagged, cleared };
    },
  };
}
