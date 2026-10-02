// The organization's asset (step 4.3, D-29): chosen at account setup, USDC by default; every money
// flow, word and record of the organization uses it.
import { orgs, type Database } from "@sotto/db";
import type { AssetConfig, AssetId } from "@sotto/sdk/cluster/assets";
import type { Address } from "@solana/kit";
import { eq } from "drizzle-orm";
import { clusterAsset, type ServerCluster } from "./cluster.ts";

export async function orgAssetId(db: Database, orgId: string): Promise<AssetId> {
  const [row] = await db.select({ asset: orgs.asset }).from(orgs).where(eq(orgs.id, orgId));
  return row?.asset ?? "usdc";
}

/** The organization's asset on this cluster, or null where the cluster does not have it. */
export async function orgAsset(
  db: Database,
  cluster: ServerCluster,
  orgId: string,
): Promise<AssetConfig | null> {
  return clusterAsset(cluster, await orgAssetId(db, orgId));
}

/** The organization's wrapped mint on this cluster, or null where the cluster lacks its asset. */
export async function orgWrappedMint(
  db: Database,
  cluster: ServerCluster | null,
  orgId: string,
): Promise<Address | null> {
  if (!cluster) return null;
  return (await orgAsset(db, cluster, orgId))?.wrappedMint ?? null;
}
