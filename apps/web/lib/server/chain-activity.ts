// What the chain shows (AC-05.3, 09 section 3; step 2.5): the org's recent onchain activity for its
// owner, read from chain_activity only, which the worker's index-accounts job writes from finalized
// transactions: when, which instruction, which accounts, and an amount only where the chain shows one,
// a confidential deposit's or withdrawal's. Nothing here comes from Sotto's own payment records.
import { chainActivity, type Database } from "@sotto/db";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireMoneyAccess } from "./orgs.ts";
import type { Session } from "./session.ts";

export const chainActivityQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(10),
    /** Step 2.12 (AC-05.2): only the public flows, deposits and withdrawals, oldest first. */
    flows: z.literal("public").optional(),
    /** With flows: from this UTC day on. */
    since: z.iso.date().optional(),
  })
  .strict();

/** The most public flows one request returns, about six months of an active account. */
export const PUBLIC_FLOWS_MAX = 500;

export type ChainActivityView = {
  id: string;
  signature: string;
  slot: string;
  blockTime: string | null;
  type: (typeof chainActivity.$inferSelect)["instructionType"];
  tokenAccount: string;
  counterparty: string | null;
  /** Base units of a confidential deposit or withdrawal, public onchain; null for the rest. */
  publicAmount: string | null;
};

export async function listChainActivity(
  db: Database,
  session: Session | null,
  orgId: string,
  limit: number,
): Promise<ChainActivityView[]> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  const rows = await db
    .select()
    .from(chainActivity)
    .where(and(eq(chainActivity.orgId, orgId)))
    .orderBy(desc(chainActivity.slot), desc(chainActivity.instructionIndex))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id.toString(),
    signature: row.signature,
    slot: row.slot.toString(),
    blockTime: row.blockTime?.toISOString() ?? null,
    type: row.instructionType,
    tokenAccount: row.tokenAccount,
    counterparty: row.counterpartyAddress,
    publicAmount: row.publicAmountBaseUnits?.toString() ?? null,
  }));
}

/**
 * The org's public deposits and withdrawals since a UTC day, oldest first (step 2.12): what the balance
 * history adds to a snapshot. Only rows with a block time, which places them against a snapshot.
 */
export async function listPublicFlows(
  db: Database,
  session: Session | null,
  orgId: string,
  since: string,
): Promise<ChainActivityView[]> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  const rows = await db
    .select()
    .from(chainActivity)
    .where(
      and(
        eq(chainActivity.orgId, orgId),
        inArray(chainActivity.instructionType, ["deposit", "withdraw"]),
        gte(chainActivity.blockTime, new Date(`${since}T00:00:00.000Z`)),
      ),
    )
    .orderBy(asc(chainActivity.slot), asc(chainActivity.instructionIndex))
    .limit(PUBLIC_FLOWS_MAX);
  return rows.map((row) => ({
    id: row.id.toString(),
    signature: row.signature,
    slot: row.slot.toString(),
    blockTime: row.blockTime?.toISOString() ?? null,
    type: row.instructionType,
    tokenAccount: row.tokenAccount,
    counterparty: row.counterpartyAddress,
    publicAmount: row.publicAmountBaseUnits?.toString() ?? null,
  }));
}
