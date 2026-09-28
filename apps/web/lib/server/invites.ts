// Invites (F-07 AC-07.3, 07 section 7, 08 section 3; step 1.8). The owner creates a recipient invite
// for one recipient (a money endpoint: requireMoneyAccess, owner); the link carries a random token and
// the database stores only its SHA-256 (as sessions do), so a database copy cannot accept invites. The
// link expires after 7 days; a new link replaces the open one. Accepting needs a session with the
// recipient's wallet: it adds the recipient membership, links the recipient to the user and creates
// the recipient's own_payslips grant (active once the user has a viewing key, 07 section 5).
import { createHash, randomBytes } from "node:crypto";
import {
  grants,
  invites,
  memberships,
  orgs,
  recipients,
  viewerKeys,
  type Database,
} from "@sotto/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { ApiError, apiErrors } from "./errors.ts";
import { requireMoneyAccess } from "./orgs.ts";
import { recipientErrors } from "./recipients.ts";
import type { Session } from "./session.ts";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 32 random bytes in base64url without padding. */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function inviteTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const inviteCreateSchema = z
  .object({ role: z.literal("recipient"), recipientId: z.uuid() })
  .strict();

export const inviteErrors = {
  notFound: () => new ApiError(404, "invite_not_found", "This invite does not exist"),
  expired: () =>
    new ApiError(
      409,
      "invite_expired",
      "This invite has expired; ask the organization for a new link",
    ),
  accepted: () => new ApiError(409, "invite_accepted", "This invite has already been accepted"),
  unavailable: () =>
    new ApiError(409, "invite_unavailable", "This organization cannot take new members right now"),
  wrongWallet: (wallet: string) =>
    new ApiError(
      403,
      "invite_wrong_wallet",
      // The message is also the HTTP reason phrase, so it stays ASCII: the full address.
      `This invite is for the wallet ${wallet}. Sign in with that wallet.`,
    ),
};

export async function createRecipientInvite(
  db: Database,
  session: Session | null,
  orgId: string,
  input: z.infer<typeof inviteCreateSchema>,
  origin: string,
  now = new Date(),
): Promise<{ url: string; expiresAt: string }> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  if (!session) throw apiErrors.unauthenticated();
  const [recipient] = await db
    .select({ id: recipients.id, userId: recipients.userId })
    .from(recipients)
    .where(and(eq(recipients.id, input.recipientId), eq(recipients.orgId, orgId)))
    .limit(1);
  if (!recipient) throw recipientErrors.notFound();
  if (recipient.userId !== null) throw recipientErrors.joined();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  await db.transaction(async (tx) => {
    await tx
      .delete(invites)
      .where(and(eq(invites.recipientId, recipient.id), isNull(invites.acceptedAt)));
    await tx.insert(invites).values({
      token: inviteTokenHash(token),
      orgId,
      role: "recipient",
      createdBy: session.userId,
      expiresAt,
      recipientId: recipient.id,
    });
  });
  return { url: `${origin}/app/invite/${token}`, expiresAt: expiresAt.toISOString() };
}

export type InviteView = {
  org: { id: string; displayName: string };
  status: "open" | "expired" | "accepted" | "unavailable";
  /**
   * Only for a session with the invited wallet (founder, step 1.8.1): the recipient's name, role and
   * wallet and the link's expiry. Before sign in the page shows only the organization.
   */
  details: {
    role: string;
    recipient: { displayName: string; roleTitle: string | null; wallet: string };
    expiresAt: string;
  } | null;
  /** For a session with another wallet: the wallet the invite is for, and nothing else about it. */
  expectedWallet: string | null;
  /** The signed in user accepted it (the invite page then continues with setup). */
  acceptedByYou: boolean;
};

export async function readInvite(
  db: Database,
  token: string,
  session: Session | null,
  now = new Date(),
): Promise<InviteView> {
  if (!TOKEN.test(token)) throw inviteErrors.notFound();
  const [row] = await db
    .select({
      role: invites.role,
      expiresAt: invites.expiresAt,
      acceptedBy: invites.acceptedBy,
      acceptedAt: invites.acceptedAt,
      orgId: orgs.id,
      orgName: orgs.displayName,
      orgStatus: orgs.status,
      recipientName: recipients.displayName,
      recipientRole: recipients.roleTitle,
      recipientWallet: recipients.wallet,
    })
    .from(invites)
    .innerJoin(orgs, eq(orgs.id, invites.orgId))
    .leftJoin(recipients, eq(recipients.id, invites.recipientId))
    .where(eq(invites.token, inviteTokenHash(token)))
    .limit(1);
  if (!row) throw inviteErrors.notFound();
  const status: InviteView["status"] =
    row.acceptedAt !== null
      ? "accepted"
      : row.expiresAt <= now
        ? "expired"
        : row.orgStatus !== "active"
          ? "unavailable"
          : "open";
  const invited = session !== null && row.recipientWallet !== null;
  const yours = invited && session.wallet === row.recipientWallet;
  return {
    org: { id: row.orgId, displayName: row.orgName },
    status,
    details:
      yours && row.recipientName !== null && row.recipientWallet !== null
        ? {
            role: row.role,
            recipient: {
              displayName: row.recipientName,
              roleTitle: row.recipientRole,
              wallet: row.recipientWallet,
            },
            expiresAt: row.expiresAt.toISOString(),
          }
        : null,
    expectedWallet: invited && !yours ? row.recipientWallet : null,
    acceptedByYou: session !== null && row.acceptedBy === session.userId,
  };
}

export async function acceptInvite(
  db: Database,
  session: Session | null,
  token: string,
  now = new Date(),
): Promise<{ orgId: string; role: string; grant: { status: "active" | "pending_viewer_key" } }> {
  if (!session) throw apiErrors.unauthenticated();
  if (!TOKEN.test(token)) throw inviteErrors.notFound();
  const hash = inviteTokenHash(token);
  return db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(invites)
      .where(eq(invites.token, hash))
      .for("update")
      .limit(1);
    if (!invite) throw inviteErrors.notFound();
    if (invite.acceptedAt !== null) throw inviteErrors.accepted();
    if (invite.expiresAt <= now) throw inviteErrors.expired();
    const [org] = await tx
      .select({ status: orgs.status })
      .from(orgs)
      .where(eq(orgs.id, invite.orgId))
      .limit(1);
    if (org?.status !== "active") throw inviteErrors.unavailable();
    if (invite.role !== "recipient" || !invite.recipientId) throw inviteErrors.notFound();
    const [recipient] = await tx
      .select({ id: recipients.id, wallet: recipients.wallet, userId: recipients.userId })
      .from(recipients)
      .where(eq(recipients.id, invite.recipientId))
      .for("update")
      .limit(1);
    if (!recipient) throw inviteErrors.notFound();
    if (recipient.wallet !== session.wallet) throw inviteErrors.wrongWallet(recipient.wallet);
    if (recipient.userId !== null && recipient.userId !== session.userId) {
      throw inviteErrors.accepted();
    }

    await tx
      .insert(memberships)
      .values({ orgId: invite.orgId, userId: session.userId, role: "recipient" })
      .onConflictDoUpdate({
        target: [memberships.orgId, memberships.userId, memberships.role],
        set: { removedAt: null },
      });
    await tx
      .update(recipients)
      .set({ userId: session.userId })
      .where(eq(recipients.id, recipient.id));
    const [key] = await tx
      .select({ id: viewerKeys.id })
      .from(viewerKeys)
      .where(and(eq(viewerKeys.userId, session.userId), eq(viewerKeys.status, "active")))
      .limit(1);
    const status = key ? ("active" as const) : ("pending_viewer_key" as const);
    await tx.insert(grants).values({
      orgId: invite.orgId,
      viewerUserId: session.userId,
      inviteToken: hash,
      scope: "own_payslips",
      status,
      createdBy: invite.createdBy,
    });
    const accepted = await tx
      .update(invites)
      .set({ acceptedBy: session.userId, acceptedAt: now })
      .where(and(eq(invites.token, hash), isNull(invites.acceptedAt), gt(invites.expiresAt, now)))
      .returning({ token: invites.token });
    if (!accepted[0]) throw inviteErrors.accepted();
    return { orgId: invite.orgId, role: invite.role, grant: { status } };
  });
}
