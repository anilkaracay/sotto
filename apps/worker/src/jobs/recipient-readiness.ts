// recipient-readiness (08 section 4, AC-07.2; step 1.8). Every 60 seconds, re-checks up to 100
// recipients that are not ready, least recently checked first: the recipient's associated wUSDC account
// is read from chain (public fields, no keys) and the readiness stored (no account, not set up for
// confidential payments, or ready). The cluster comes from the RPC's genesis hash (facts H6); devnet
// takes its wUSDC mint from the cluster config, a local ledger derives it from LOCALNET_USDC_MINT, and
// without a mint the job waits and logs. With nothing to check it makes no RPC call. Since step 4.3
// (D-29) each recipient is read for its organization's asset: devnet's registry, or on a local ledger
// LOCALNET_USDC_MINT and LOCALNET_DEVUSD_MINT.
import { orgs, recipients, type Database } from "@sotto/db";
import type { AssetId } from "@sotto/sdk/cluster/assets";
import {
  clusterFromGenesisHash,
  getClusterConfig,
  type AvailableClusterConfig,
} from "@sotto/sdk/cluster";
import {
  associatedTokenAccount,
  recipientReadiness,
  tokenAccountState,
  type RecipientReadiness,
} from "@sotto/sdk/confidential/public";
import type { SolanaRpc } from "@sotto/sdk/tx";
import { wrappedMintAddress } from "@sotto/sdk/wrap";
import { address, fetchEncodedAccounts, type Address } from "@solana/kit";
import { asc, eq, ne, sql } from "drizzle-orm";
import type { Job } from "./runner.ts";

export const RECIPIENT_READINESS_INTERVAL_MS = 60_000;
const BATCH = 100;

export type RecipientReadinessDeps = {
  db: Database;
  rpc: SolanaRpc;
  localnetUsdcMint: Address | null;
  /** The local ledger's devUSD mint (step 4.3), when the bootstrap created one. */
  localnetDevusdMint?: Address | null;
  now?: () => Date;
};

/** Each asset's wrapped mint on the RPC's cluster (step 4.3). */
async function clusterMints(
  rpc: SolanaRpc,
  localnet: Partial<Record<AssetId, Address | null>>,
): Promise<Map<AssetId, Address>> {
  const mints = new Map<AssetId, Address>();
  const cluster = clusterFromGenesisHash(await rpc.getGenesisHash().send());
  if (cluster === "mainnet") return mints;
  if (cluster === "devnet") {
    const devnet = getClusterConfig("devnet") as AvailableClusterConfig;
    for (const asset of devnet.assets) mints.set(asset.id, asset.wrappedMint);
    return mints;
  }
  const config = getClusterConfig("localnet") as AvailableClusterConfig;
  for (const [id, base] of Object.entries(localnet) as [AssetId, Address | null][]) {
    if (base) mints.set(id, await wrappedMintAddress(base, config.programs.tokenWrap));
  }
  return mints;
}

export function recipientReadinessJob(deps: RecipientReadinessDeps): Job {
  let mints: Map<AssetId, Address> | undefined;
  return {
    name: "recipient-readiness",
    intervalMs: RECIPIENT_READINESS_INTERVAL_MS,
    run: async ({ log }) => {
      const rows = await deps.db
        .select({ id: recipients.id, wallet: recipients.wallet, asset: orgs.asset })
        .from(recipients)
        .innerJoin(orgs, eq(orgs.id, recipients.orgId))
        .where(ne(recipients.readiness, "ready"))
        .orderBy(sql`${recipients.readinessCheckedAt} asc nulls first`, asc(recipients.id))
        .limit(BATCH);
      if (rows.length === 0) return { checked: 0, ready: 0 };
      mints ??= await clusterMints(deps.rpc, {
        usdc: deps.localnetUsdcMint,
        devusd: deps.localnetDevusdMint ?? null,
      });
      const known = mints;
      const readable = rows.filter((row) => known.has(row.asset));
      if (readable.length < rows.length) {
        log("recipient_readiness_no_mint", { waiting: rows.length - readable.length }, "warn");
      }
      if (readable.length === 0) return { checked: 0, ready: 0 };
      const mintOf = (row: (typeof readable)[number]) => known.get(row.asset) as Address;
      const accounts = await fetchEncodedAccounts(
        deps.rpc,
        await Promise.all(
          readable.map((row) => associatedTokenAccount(address(row.wallet), mintOf(row))),
        ),
        { commitment: "confirmed" },
      );
      const checkedAt = deps.now?.() ?? new Date();
      let ready = 0;
      for (const [index, row] of readable.entries()) {
        const account = accounts[index];
        let readiness: RecipientReadiness = "not_configured";
        try {
          if (account) {
            readiness = recipientReadiness(tokenAccountState(account), {
              owner: address(row.wallet),
              mint: mintOf(row),
            });
          }
        } catch {
          readiness = "not_configured";
        }
        if (readiness === "ready") ready += 1;
        await deps.db
          .update(recipients)
          .set({ readiness, readinessCheckedAt: checkedAt })
          .where(eq(recipients.id, row.id));
      }
      return { checked: readable.length, ready };
    },
  };
}
