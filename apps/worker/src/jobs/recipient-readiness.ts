// recipient-readiness (08 section 4, AC-07.2; step 1.8). Every 60 seconds, re-checks up to 100
// recipients that are not ready, least recently checked first: the recipient's associated wUSDC account
// is read from chain (public fields, no keys) and the readiness stored (no account, not set up for
// confidential payments, or ready). The cluster comes from the RPC's genesis hash (facts H6); devnet
// takes its wUSDC mint from the cluster config, a local ledger derives it from LOCALNET_USDC_MINT, and
// without a mint the job waits and logs. With nothing to check it makes no RPC call.
import { recipients, type Database } from "@sotto/db";
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
  now?: () => Date;
};

async function clusterMint(
  rpc: SolanaRpc,
  localnetUsdcMint: Address | null,
): Promise<Address | null> {
  const cluster = clusterFromGenesisHash(await rpc.getGenesisHash().send());
  if (cluster === "mainnet") return null;
  if (cluster === "devnet") {
    const devnet = getClusterConfig("devnet") as AvailableClusterConfig;
    return devnet.wrappedUsdcMint;
  }
  if (!localnetUsdcMint) return null;
  const localnet = getClusterConfig("localnet") as AvailableClusterConfig;
  return wrappedMintAddress(localnetUsdcMint, localnet.programs.tokenWrap);
}

export function recipientReadinessJob(deps: RecipientReadinessDeps): Job {
  let mint: Address | null | undefined;
  return {
    name: "recipient-readiness",
    intervalMs: RECIPIENT_READINESS_INTERVAL_MS,
    run: async ({ log }) => {
      const rows = await deps.db
        .select({ id: recipients.id, wallet: recipients.wallet })
        .from(recipients)
        .where(ne(recipients.readiness, "ready"))
        .orderBy(sql`${recipients.readinessCheckedAt} asc nulls first`, asc(recipients.id))
        .limit(BATCH);
      if (rows.length === 0) return { checked: 0, ready: 0 };
      mint ??= await clusterMint(deps.rpc, deps.localnetUsdcMint);
      if (!mint) {
        log("recipient_readiness_no_mint", { waiting: rows.length }, "warn");
        return { checked: 0, ready: 0 };
      }
      const wusdc = mint;
      const accounts = await fetchEncodedAccounts(
        deps.rpc,
        await Promise.all(rows.map((row) => associatedTokenAccount(address(row.wallet), wusdc))),
        { commitment: "confirmed" },
      );
      const checkedAt = deps.now?.() ?? new Date();
      let ready = 0;
      for (const [index, row] of rows.entries()) {
        const account = accounts[index];
        let readiness: RecipientReadiness = "not_configured";
        try {
          if (account) {
            readiness = recipientReadiness(tokenAccountState(account), {
              owner: address(row.wallet),
              mint: wusdc,
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
      return { checked: rows.length, ready };
    },
  };
}
