// The devUSD faucet's web side (step 4.3, D-29; founder, 2026-10-02): devnet only, at most 1,000,000
// devUSD per wallet per 24 hours, rate limited and logged. The owner of an active devUSD organization
// asks for devUSD to their own wallet; the web checks the cluster (the configured cluster must be
// devnet and the RPC must serve devnet's genesis hash) and the wallet's 24 hour total, and queues the
// mint. The worker, which alone holds the mint authority, mints it (apps/worker/src/jobs/devusd-faucet.ts)
// and checks the cluster again. Any other cluster is refused, here and there.
import { faucetMints, orgs, type Database } from "@sotto/db";
import { GENESIS_HASHES } from "@sotto/sdk/cluster";
import type { SolanaRpc } from "@sotto/sdk/tx";
import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
import { clusterAsset, type ServerCluster } from "./cluster.ts";
import { ApiError, apiErrors } from "./errors.ts";
import { log } from "./log.ts";
import { requireMoneyAccess } from "./orgs.ts";
import type { Session } from "./session.ts";

/**
 * 1,000,000 devUSD in base units (6 decimals) per wallet per 24 hours (step 4.6; founder, 2026-10-09:
 * it has no value and Sotto mints it; 10,000 before).
 */
export const FAUCET_LIMIT = 1_000_000_000_000n;
export const FAUCET_WINDOW_MS = 24 * 60 * 60 * 1000;

export const faucetErrors = {
  /** Any cluster but devnet, or an RPC that does not serve devnet (CI proves this refusal). */
  wrongCluster: () =>
    new ApiError(403, "faucet_devnet_only", "The devUSD faucet runs on devnet only"),
  notDevusd: () =>
    new ApiError(
      409,
      "faucet_not_devusd",
      "This organization holds USDC; the faucet gives devUSD only",
    ),
  networkUnreachable: () =>
    new ApiError(503, "faucet_network_unreachable", "The network could not be reached. Try again."),
  overLimit: (remaining: bigint) =>
    new ApiError(
      429,
      "faucet_limit",
      `A wallet can get at most 1,000,000 devUSD in 24 hours; ${(remaining / 1_000_000n).toString()} devUSD is left`,
    ),
};

export type FaucetMintView = {
  id: string;
  amount: string;
  status: "pending" | "sent" | "minted" | "failed";
  signature: string | null;
  createdAt: string;
};

export type FaucetView = {
  wallet: string;
  limit: string;
  /** What the wallet may still ask for in the current 24 hours, in base units. */
  remaining: string;
  mints: FaucetMintView[];
};

/**
 * The faucet runs only where the configured cluster is devnet with devUSD in its registry and the RPC
 * serves devnet's genesis hash. Throws faucet_devnet_only otherwise.
 */
export async function requireFaucetCluster(
  cluster: ServerCluster | null,
  rpc: () => SolanaRpc,
): Promise<void> {
  if (!cluster || cluster.config.name !== "devnet" || !clusterAsset(cluster, "devusd")) {
    throw faucetErrors.wrongCluster();
  }
  let genesisHash: string;
  try {
    genesisHash = await rpc().getGenesisHash().send();
  } catch {
    throw faucetErrors.networkUnreachable();
  }
  if (genesisHash !== GENESIS_HASHES.devnet) throw faucetErrors.wrongCluster();
}

/** The owner of an active devUSD organization (the treasury the faucet funds). */
async function requireDevusdOwner(db: Database, session: Session | null, orgId: string) {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  if (!session) throw apiErrors.unauthenticated();
  const [org] = await db.select({ asset: orgs.asset }).from(orgs).where(eq(orgs.id, orgId));
  if (org?.asset !== "devusd") throw faucetErrors.notDevusd();
  return session;
}

/** The wallet's faucet total in the 24 hours before `now`, failed mints left out. */
async function usedSince(db: Pick<Database, "select">, wallet: string, now: Date): Promise<bigint> {
  const [row] = await db
    .select({
      used: sql<string>`coalesce(sum(${faucetMints.amountBaseUnits}), 0)::text`,
    })
    .from(faucetMints)
    .where(
      and(
        eq(faucetMints.wallet, wallet),
        gt(faucetMints.createdAt, new Date(now.getTime() - FAUCET_WINDOW_MS)),
        ne(faucetMints.status, "failed"),
      ),
    );
  return BigInt(row?.used ?? "0");
}

export async function readFaucet(
  db: Database,
  session: Session | null,
  cluster: ServerCluster | null,
  rpc: () => SolanaRpc,
  orgId: string,
  now = new Date(),
): Promise<FaucetView> {
  await requireFaucetCluster(cluster, rpc);
  const owner = await requireDevusdOwner(db, session, orgId);
  const used = await usedSince(db, owner.wallet, now);
  const rows = await db
    .select()
    .from(faucetMints)
    .where(eq(faucetMints.wallet, owner.wallet))
    .orderBy(desc(faucetMints.createdAt))
    .limit(5);
  return {
    wallet: owner.wallet,
    limit: FAUCET_LIMIT.toString(),
    remaining: (used >= FAUCET_LIMIT ? 0n : FAUCET_LIMIT - used).toString(),
    mints: rows.map((row) => ({
      id: row.id,
      amount: row.amountBaseUnits.toString(),
      status: row.status,
      signature: row.signature,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

/**
 * Queues a mint of `amount` base units of devUSD to the owner's wallet, within the wallet's 24 hour
 * limit. One wallet's requests are serialized by a transaction scoped advisory lock, so two at once
 * never pass the limit together.
 */
export async function requestFaucet(
  db: Database,
  session: Session | null,
  cluster: ServerCluster | null,
  rpc: () => SolanaRpc,
  orgId: string,
  amount: bigint,
  now = new Date(),
): Promise<FaucetMintView> {
  await requireFaucetCluster(cluster, rpc);
  const owner = await requireDevusdOwner(db, session, orgId);
  const row = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`faucet:${owner.wallet}`}))`);
    const used = await usedSince(tx, owner.wallet, now);
    const remaining = used >= FAUCET_LIMIT ? 0n : FAUCET_LIMIT - used;
    if (amount > remaining) throw faucetErrors.overLimit(remaining);
    const [inserted] = await tx
      .insert(faucetMints)
      .values({ orgId, wallet: owner.wallet, amountBaseUnits: amount, createdAt: now })
      .returning();
    if (!inserted) throw new Error("faucet insert returned no row");
    return inserted;
  });
  // The amount is public onchain once minted, but the log keeps to who and which request.
  log("info", "faucet_requested", { orgId, wallet: owner.wallet, mintId: row.id });
  return {
    id: row.id,
    amount: row.amountBaseUnits.toString(),
    status: row.status,
    signature: row.signature,
    createdAt: row.createdAt.toISOString(),
  };
}
