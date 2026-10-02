// My pay (F-12, AC-12.1, AC-12.2; step 2.6): what a recipient's pay page needs from Sotto besides their
// own records (GET /orgs/:id/disclosures, opened in their tab): for each payment to them, when it
// settled and who else holds its record (the holders of the org's readable grants; the org itself
// always can), and "What your colleagues see": the org's transfers into the recipient's wUSDC account
// as chain_activity shows them, public data only (accounts and times; the amount is sealed). No amount
// exists here.
import {
  chainActivity,
  disclosures,
  grants,
  orgs,
  payments,
  recipients,
  users,
  type Database,
} from "@sotto/db";
import type { AssetId } from "@sotto/sdk/cluster/assets";
import { associatedTokenAccount } from "@sotto/sdk/confidential/public";
import { address } from "@solana/kit";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { ServerCluster } from "./cluster.ts";
import { orgWrappedMint } from "./assets.ts";
import { apiErrors } from "./errors.ts";
import { readableGrantCondition } from "./grants.ts";
import { requireMoneyAccess } from "./orgs.ts";
import type { Session } from "./session.ts";

export type PayView = {
  /** The organization's asset (step 4.3): its payslips say USDC or devUSD. */
  org: { id: string; displayName: string; asset: AssetId };
  ownerWallet: string;
  recipient: { displayName: string; roleTitle: string | null; wallet: string };
  /** The recipient's associated account of the org's wrapped asset; null while the cluster has no mint. */
  tokenAccount: string | null;
  payments: {
    id: string;
    kind: "single" | "payroll_line";
    status: string;
    settledAt: string | null;
    /** Holders of the org's readable grants who hold this payment's record. */
    readers: string[];
  }[];
  /** The org's transfers into the recipient's account, newest first (AC-12.2). */
  chain: { signature: string; blockTime: string | null; from: string; to: string }[];
};

export async function readPay(
  db: Database,
  session: Session | null,
  orgId: string,
  cluster: ServerCluster | null,
  now = new Date(),
): Promise<PayView> {
  await requireMoneyAccess(db, session, orgId, ["recipient"]);
  if (!session) throw apiErrors.unauthenticated();
  const [org] = await db
    .select({
      id: orgs.id,
      displayName: orgs.displayName,
      asset: orgs.asset,
      ownerWallet: users.wallet,
    })
    .from(orgs)
    .innerJoin(users, eq(users.id, orgs.ownerUserId))
    .where(eq(orgs.id, orgId))
    .limit(1);
  const [recipient] = await db
    .select()
    .from(recipients)
    .where(and(eq(recipients.orgId, orgId), eq(recipients.userId, session.userId)))
    .limit(1);
  if (!org || !recipient) throw apiErrors.forbidden();
  const rows = await db
    .select({
      id: payments.id,
      kind: payments.kind,
      status: payments.status,
      settledAt: payments.settledAt,
    })
    .from(payments)
    .where(and(eq(payments.orgId, orgId), eq(payments.recipientId, recipient.id)))
    .orderBy(desc(payments.createdAt));
  const ids = rows.map((row) => row.id);
  const held = ids.length
    ? await db
        .selectDistinct({ subject: disclosures.subject, holder: grants.holderName })
        .from(disclosures)
        .innerJoin(grants, eq(grants.id, disclosures.grantId))
        .where(
          and(
            eq(disclosures.orgId, orgId),
            inArray(disclosures.subject, ids),
            isNotNull(grants.holderName),
            readableGrantCondition(now),
          ),
        )
    : [];
  // The organization's asset (step 4.3).
  const mint = await orgWrappedMint(db, cluster, orgId);
  const tokenAccount = mint ? await associatedTokenAccount(address(recipient.wallet), mint) : null;
  const chain = tokenAccount
    ? await db
        .select({
          signature: chainActivity.signature,
          blockTime: chainActivity.blockTime,
          from: chainActivity.tokenAccount,
          to: chainActivity.counterpartyAddress,
        })
        .from(chainActivity)
        .where(
          and(
            eq(chainActivity.orgId, orgId),
            eq(chainActivity.instructionType, "transfer_out"),
            eq(chainActivity.counterpartyAddress, tokenAccount),
          ),
        )
        .orderBy(desc(chainActivity.slot))
        .limit(24)
    : [];
  return {
    org: { id: org.id, displayName: org.displayName, asset: org.asset },
    ownerWallet: org.ownerWallet,
    recipient: {
      displayName: recipient.displayName,
      roleTitle: recipient.roleTitle,
      wallet: recipient.wallet,
    },
    tokenAccount,
    payments: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      settledAt: row.settledAt?.toISOString() ?? null,
      readers: [
        ...new Set(
          held.flatMap((entry) => (entry.subject === row.id && entry.holder ? [entry.holder] : [])),
        ),
      ].sort(),
    })),
    chain: chain.map((row) => ({
      signature: row.signature,
      blockTime: row.blockTime?.toISOString() ?? null,
      from: row.from,
      to: row.to ?? "",
    })),
  };
}
