// Recipients (F-07, 08 section 3; step 1.8): the people and companies an org pays. Money endpoints:
// `requireMoneyAccess` with the owner role (AC-02.2). Readiness comes from chain state (AC-07.2): the
// recipient's associated wUSDC account read with the server's RPC when the owner adds a recipient or
// asks again, and by the worker's recipient-readiness job. The private blob is a sealed box the owner's
// browser made; the server stores and returns it and cannot open it.
import { invites, recipients, type Database } from "@sotto/db";
import {
  associatedTokenAccount,
  readTokenAccountState,
  recipientReadiness,
} from "@sotto/sdk/confidential/public";
import type { SolanaRpc } from "@sotto/sdk/tx";
import { address, type Address } from "@solana/kit";
import { and, eq, isNull } from "drizzle-orm";
import type { Readiness, RecipientCreate, RecipientUpdate } from "../recipient.ts";
import type { ServerCluster } from "./cluster.ts";
import { orgWrappedMint } from "./assets.ts";
import { ApiError } from "./errors.ts";
import { requireMoneyAccess } from "./orgs.ts";
import type { Session } from "./session.ts";

export const recipientErrors = {
  notFound: () => new ApiError(404, "recipient_not_found", "Recipient not found"),
  exists: () => new ApiError(409, "recipient_exists", "This wallet is already a recipient"),
  joined: () =>
    new ApiError(
      409,
      "recipient_joined",
      "This recipient has joined; removing a joined recipient is not available in this build",
    ),
};

export type RecipientView = {
  id: string;
  displayName: string;
  roleTitle: string | null;
  team: string | null;
  country: string | null;
  wallet: string;
  /** The recipient accepted an invite and signed in with the wallet. */
  joined: boolean;
  readiness: Readiness;
  readinessCheckedAt: string | null;
  /** Sealed to the owner's viewing key, base64. */
  privateBlob: string | null;
  invite: { status: "none" | "pending" | "accepted"; expiresAt: string | null };
};

type Row = typeof recipients.$inferSelect;
type InviteRow = Pick<typeof invites.$inferSelect, "recipientId" | "expiresAt" | "acceptedAt">;

function inviteOf(recipientId: string, rows: InviteRow[], now: Date): RecipientView["invite"] {
  const mine = rows.filter((row) => row.recipientId === recipientId);
  if (mine.some((row) => row.acceptedAt !== null)) return { status: "accepted", expiresAt: null };
  const open = mine
    .filter((row) => row.expiresAt > now)
    .sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime())[0];
  return open
    ? { status: "pending", expiresAt: open.expiresAt.toISOString() }
    : { status: "none", expiresAt: null };
}

function view(row: Row, inviteRows: InviteRow[], now = new Date()): RecipientView {
  return {
    id: row.id,
    displayName: row.displayName,
    roleTitle: row.roleTitle,
    team: row.team,
    country: row.country,
    wallet: row.wallet,
    joined: row.userId !== null,
    readiness: row.readiness,
    readinessCheckedAt: row.readinessCheckedAt?.toISOString() ?? null,
    privateBlob: row.privateBlob ? Buffer.from(row.privateBlob).toString("base64") : null,
    invite: inviteOf(row.id, inviteRows, now),
  };
}

/**
 * AC-07.2 from chain, for the organization's wrapped mint (step 4.3: orgWrappedMint); null when there
 * is no such mint or the chain cannot be read.
 */
export async function readinessFromChain(
  rpc: SolanaRpc,
  mint: Address | null,
  wallet: string,
): Promise<Readiness | null> {
  if (!mint) return null;
  try {
    const owner = address(wallet);
    const state = await readTokenAccountState(rpc, await associatedTokenAccount(owner, mint));
    return recipientReadiness(state, { owner, mint });
  } catch {
    return null;
  }
}

async function orgInvites(db: Database, orgId: string): Promise<InviteRow[]> {
  return db
    .select({
      recipientId: invites.recipientId,
      expiresAt: invites.expiresAt,
      acceptedAt: invites.acceptedAt,
    })
    .from(invites)
    .where(eq(invites.orgId, orgId));
}

async function ownedRecipient(db: Database, orgId: string, recipientId: string): Promise<Row> {
  const [row] = await db
    .select()
    .from(recipients)
    .where(and(eq(recipients.id, recipientId), eq(recipients.orgId, orgId)))
    .limit(1);
  if (!row) throw recipientErrors.notFound();
  return row;
}

export async function listRecipients(
  db: Database,
  session: Session | null,
  orgId: string,
): Promise<RecipientView[]> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  const [rows, inviteRows] = await Promise.all([
    db.select().from(recipients).where(eq(recipients.orgId, orgId)).orderBy(recipients.displayName),
    orgInvites(db, orgId),
  ]);
  return rows.map((row) => view(row, inviteRows));
}

export async function createRecipient(
  db: Database,
  session: Session | null,
  orgId: string,
  input: RecipientCreate,
  chain: { rpc: SolanaRpc; cluster: ServerCluster | null },
): Promise<RecipientView> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  const readiness = await readinessFromChain(
    chain.rpc,
    await orgWrappedMint(db, chain.cluster, orgId),
    input.wallet,
  );
  const inserted = await db
    .insert(recipients)
    .values({
      orgId,
      displayName: input.displayName,
      roleTitle: input.roleTitle ?? null,
      team: input.team ?? null,
      country: input.country ?? null,
      wallet: input.wallet,
      privateBlob: input.privateBlob ? Buffer.from(input.privateBlob, "base64") : null,
      readiness: readiness ?? "no_account",
      readinessCheckedAt: readiness ? new Date() : null,
    })
    .onConflictDoNothing({ target: [recipients.orgId, recipients.wallet] })
    .returning();
  const row = inserted[0];
  if (!row) throw recipientErrors.exists();
  return view(row, []);
}

export async function updateRecipient(
  db: Database,
  session: Session | null,
  orgId: string,
  recipientId: string,
  input: RecipientUpdate,
): Promise<RecipientView> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  await ownedRecipient(db, orgId, recipientId);
  const [row] = await db
    .update(recipients)
    .set({
      ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      ...(input.roleTitle === undefined ? {} : { roleTitle: input.roleTitle }),
      ...(input.team === undefined ? {} : { team: input.team }),
      ...(input.country === undefined ? {} : { country: input.country }),
      ...(input.privateBlob === undefined
        ? {}
        : {
            privateBlob: input.privateBlob ? Buffer.from(input.privateBlob, "base64") : null,
          }),
    })
    .where(and(eq(recipients.id, recipientId), eq(recipients.orgId, orgId)))
    .returning();
  if (!row) throw recipientErrors.notFound();
  return view(row, await orgInvites(db, orgId));
}

/** Removes a recipient who has not joined, with its open invites; a joined recipient stays (409). */
export async function deleteRecipient(
  db: Database,
  session: Session | null,
  orgId: string,
  recipientId: string,
): Promise<void> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  const row = await ownedRecipient(db, orgId, recipientId);
  if (row.userId !== null) throw recipientErrors.joined();
  const deleted = await db
    .delete(recipients)
    .where(
      and(eq(recipients.id, recipientId), eq(recipients.orgId, orgId), isNull(recipients.userId)),
    )
    .returning({ id: recipients.id });
  if (!deleted[0]) throw recipientErrors.joined();
}

/** POST /orgs/:id/recipients/:rid/readiness: reads chain state again (AC-07.2). */
export async function checkRecipientReadiness(
  db: Database,
  session: Session | null,
  orgId: string,
  recipientId: string,
  chain: { rpc: SolanaRpc; cluster: ServerCluster | null },
): Promise<RecipientView> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  const current = await ownedRecipient(db, orgId, recipientId);
  const readiness = await readinessFromChain(
    chain.rpc,
    await orgWrappedMint(db, chain.cluster, orgId),
    current.wallet,
  );
  if (readiness === null) {
    throw new ApiError(
      503,
      "readiness_unavailable",
      "The recipient's account could not be read from the network",
    );
  }
  const [row] = await db
    .update(recipients)
    .set({ readiness, readinessCheckedAt: new Date() })
    .where(eq(recipients.id, recipientId))
    .returning();
  if (!row) throw recipientErrors.notFound();
  return view(row, await orgInvites(db, orgId));
}
