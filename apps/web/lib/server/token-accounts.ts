// POST /api/token-accounts (08 section 3, 06 section 3 step 5): records the owner's configured wUSDC
// account, or since step 1.8 a recipient's own account, after checking it onchain with the server's
// RPC: it exists, is a Token-2022 account of the caller's wallet for the cluster's wUSDC mint, and has
// an approved confidential extension; a recipient's readiness follows from the same read. It is a
// money endpoint (AC-02.2), so it authorizes with requireMoneyAccess. The key scheme cannot be read
// from chain (the ElGamal key is public, the scheme that derived it is not), so the browser states
// it; the hackathon build has only standard_v1 (D-03). Reads and a row, no keys and no amounts.
import { recipients, tokenAccounts, type Database } from "@sotto/db";
import {
  associatedTokenAccount,
  checkConfidentialAccount,
  readTokenAccountStateWithSlot,
  recipientReadiness,
  type AccountCheck,
} from "@sotto/sdk/confidential/public";
import type { SolanaRpc } from "@sotto/sdk/tx";
import { address, isAddress } from "@solana/kit";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { ServerCluster } from "./cluster.ts";
import { orgWrappedMint } from "./assets.ts";
import { ApiError } from "./errors.ts";
import { requireMoneyAccess } from "./orgs.ts";
import type { Session } from "./session.ts";

export const tokenAccountRegistrationSchema = z
  .object({
    orgId: z.uuid(),
    address: z.string().refine((value) => isAddress(value), "must be a base58 address"),
    keyScheme: z.literal("standard_v1"),
  })
  .strict();

export type TokenAccountRegistration = z.infer<typeof tokenAccountRegistrationSchema>;

type InvalidReason = Extract<AccountCheck, { ok: false }>["reason"];

const INVALID: Record<InvalidReason, string> = {
  missing: "The token account does not exist onchain",
  not_token_2022: "The account is not a Token-2022 token account",
  wrong_owner: "The token account belongs to another wallet",
  wrong_mint: "The token account does not hold this network's wUSDC",
  not_confidential: "The token account is not configured for confidential balances",
  not_approved: "The token account is not approved for confidential balances",
};

export const tokenAccountErrors = {
  unavailable: () =>
    new ApiError(
      503,
      "confidential_unavailable",
      "Confidential balances are not available on this network",
    ),
  invalid: (reason: InvalidReason) => new ApiError(422, "token_account_invalid", INVALID[reason]),
  taken: () =>
    new ApiError(409, "token_account_taken", "This token account is registered to another user"),
};

export type TokenAccountView = {
  id: string;
  orgId: string | null;
  cluster: string;
  address: string;
  mint: string;
  keyScheme: string;
  /** The slot of the read that verified the account; it was configured at or before it. */
  configuredSlot: string | null;
};

type Row = typeof tokenAccounts.$inferSelect;

function view(row: Row): TokenAccountView {
  return {
    id: row.id,
    orgId: row.orgId,
    cluster: row.cluster,
    address: row.address,
    mint: row.mint,
    keyScheme: row.keyScheme,
    configuredSlot: row.configuredSlot === null ? null : row.configuredSlot.toString(),
  };
}

export async function registerTokenAccount(
  db: Database,
  session: Session | null,
  rpc: SolanaRpc,
  cluster: ServerCluster | null,
  input: TokenAccountRegistration,
): Promise<{ tokenAccount: TokenAccountView; created: boolean }> {
  // The owner's account (step 1.7) or, since step 1.8, a recipient's own account.
  await requireMoneyAccess(db, session, input.orgId, ["owner", "recipient"]);
  if (!session) throw new Error("requireMoneyAccess returns only with a session");
  // The organization's asset (step 4.3, D-29).
  const mint = await orgWrappedMint(db, cluster, input.orgId);
  if (!cluster || !mint) throw tokenAccountErrors.unavailable();
  const { state, slot } = await readTokenAccountStateWithSlot(rpc, address(input.address));
  const check = checkConfidentialAccount(state, {
    owner: address(session.wallet),
    mint: mint,
  });
  if (!check.ok) throw tokenAccountErrors.invalid(check.reason);
  // A recipient of this org who records their associated wUSDC account, the account readiness reads
  // and payments go to, is ready from this read on (AC-07.3). Another account leaves readiness as it is.
  const associated = await associatedTokenAccount(address(session.wallet), mint);
  if (input.address === associated) {
    await db
      .update(recipients)
      .set({
        readiness: recipientReadiness(state, {
          owner: address(session.wallet),
          mint: mint,
        }),
        readinessCheckedAt: new Date(),
      })
      .where(and(eq(recipients.orgId, input.orgId), eq(recipients.userId, session.userId)));
  }

  const inserted = await db
    .insert(tokenAccounts)
    .values({
      userId: session.userId,
      orgId: input.orgId,
      cluster: cluster.config.name,
      address: input.address,
      mint: mint,
      keyScheme: input.keyScheme,
      configuredSlot: slot,
    })
    .onConflictDoNothing({ target: [tokenAccounts.cluster, tokenAccounts.address] })
    .returning();
  if (inserted[0]) return { tokenAccount: view(inserted[0]), created: true };

  const [existing] = await db
    .select()
    .from(tokenAccounts)
    .where(
      and(eq(tokenAccounts.cluster, cluster.config.name), eq(tokenAccounts.address, input.address)),
    )
    .limit(1);
  if (!existing || existing.userId !== session.userId) throw tokenAccountErrors.taken();
  return { tokenAccount: view(existing), created: false };
}

/** The org's recorded wUSDC account of this user on the cluster, if any (the setup page). */
export async function readOrgTokenAccount(
  db: Database,
  userId: string,
  orgId: string,
  cluster: string,
): Promise<(TokenAccountView & { applyFlagged: boolean }) | null> {
  const [row] = await db
    .select()
    .from(tokenAccounts)
    .where(
      and(
        eq(tokenAccounts.userId, userId),
        eq(tokenAccounts.orgId, orgId),
        eq(tokenAccounts.cluster, cluster as Row["cluster"]),
      ),
    )
    .limit(1);
  return row ? { ...view(row), applyFlagged: row.applyFlaggedAt !== null } : null;
}
