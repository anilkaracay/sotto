// Viewing grants (F-10, 07 sections 6 and 7, 08 section 3; step 2.4). Money endpoints (the owner of an
// active org). A grant is always created through an invite (X-37): the owner names the holder, the
// scope and the expiry, and gets a link; the holder accepts with their wallet, becomes an accountant
// of the org, registers a viewing key, and the grant activates. The scopes offered are all_payments,
// period and payroll_only; own_payslips grants are created when a recipient accepts their invite, and
// totals_only is Post-hackathon (D-27). Revoking deletes the grant's disclosures in the same
// transaction (AC-10.4). Back fill: the owner's browser asks for the owner's own records in scope that
// the grant does not have yet, opens them, seals them to the holder's viewing key and stores them
// under a manifest the owner signs (AC-10.3). Every change is written to the access log (AC-10.5).
import { randomBytes } from "node:crypto";
import {
  disclosures,
  grants,
  insertAccessEvent,
  invites,
  manifests,
  orgs,
  payments,
  recipients,
  users,
  viewerKeys,
  type Database,
} from "@sotto/db";
import { periodBounds, type GrantScope } from "@sotto/sdk/disclosure";
import { and, count, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { ApiError, apiErrors } from "./errors.ts";
import { INVITE_TTL_MS, inviteTokenHash } from "./invites.ts";
import { requireMoneyAccess } from "./orgs.ts";
import type { Session } from "./session.ts";

const CONTROL = /\p{Cc}/u;
/** The coverage bars compare with the owner's own records of the last 12 months (09 section 3). */
const COVERAGE_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
/** Items one back fill batch returns: one manifest holds at most 500 (07 section 4). */
export const BACKFILL_BATCH = 500;

export const GRANT_EXPIRY_CHOICES = ["30_days", "end_of_quarter", "end_of_year", "none"] as const;
export type GrantExpiryChoice = (typeof GRANT_EXPIRY_CHOICES)[number];

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !CONTROL.test(value), "must not contain control characters");

export const grantCreateSchema = z
  .object({
    holderName: text(120),
    holderTitle: text(80).optional(),
    /** own_payslips grants come with a recipient's invite; totals_only is Post-hackathon (D-27). */
    scope: z.enum(["all_payments", "period", "payroll_only"]),
    periodFrom: z.iso.date().optional(),
    periodTo: z.iso.date().optional(),
    expiry: z.enum(GRANT_EXPIRY_CHOICES),
  })
  .strict()
  .superRefine((value, context) => {
    const dated = value.periodFrom !== undefined || value.periodTo !== undefined;
    if (value.scope !== "period") {
      if (dated) context.addIssue({ code: "custom", message: "only a period grant has dates" });
      return;
    }
    if (!value.periodFrom || !value.periodTo) {
      context.addIssue({ code: "custom", message: "a period grant needs periodFrom and periodTo" });
      return;
    }
    if (value.periodFrom > value.periodTo) {
      context.addIssue({
        code: "custom",
        message: "the period ends on or after the day it starts",
      });
    }
  });

export const grantErrors = {
  notFound: () => new ApiError(404, "grant_not_found", "Viewing grant not found"),
  status: (status: string) =>
    new ApiError(409, "grant_status", `This viewing grant is ${status.replaceAll("_", " ")}`),
  automatic: () =>
    new ApiError(
      409,
      "grant_automatic",
      "A recipient's own payslips follow their recipient record and cannot be revoked here",
    ),
  inviteAccepted: () =>
    new ApiError(409, "grant_invite_accepted", "The holder already accepted this invite"),
};

/** The expiry of a choice, in UTC: 30 days from now, the next quarter's or year's first instant, none. */
export function expiryFor(choice: GrantExpiryChoice, now: Date): Date | null {
  const year = now.getUTCFullYear();
  switch (choice) {
    case "30_days":
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    case "end_of_quarter": {
      const nextQuarter = Math.floor(now.getUTCMonth() / 3) * 3 + 3;
      return new Date(Date.UTC(year, nextQuarter, 1));
    }
    case "end_of_year":
      return new Date(Date.UTC(year + 1, 0, 1));
    case "none":
      return null;
  }
}

export type GrantView = {
  id: string;
  scope: GrantScope;
  periodFrom: string | null;
  periodTo: string | null;
  expiresAt: string | null;
  /** The stored status, or expired once its expiry passed before the worker marked it. */
  status: "pending_viewer_key" | "active" | "revoked" | "expired";
  holder: { name: string; title: string | null };
  /** Set once the holder accepted: their wallet and, when registered, their viewing key (I-8). */
  viewer: {
    userId: string;
    wallet: string;
    viewerKey: { publicKey: string; signature: string } | null;
  } | null;
  /** The accountant invite's state; null for a recipient's own payslips. */
  invite: { status: "pending" | "accepted" | "expired"; expiresAt: string } | null;
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  /** The holder's records under this grant (a recipient's own payslips: their recipient records). */
  items: number;
  /** The owner's records in scope this grant does not have yet: what a back fill shares. */
  missing: number;
};

type GrantRow = typeof grants.$inferSelect;

function effectiveStatus(row: GrantRow, now: Date): GrantView["status"] {
  if (
    (row.status === "active" || row.status === "pending_viewer_key") &&
    row.expiresAt !== null &&
    row.expiresAt <= now
  ) {
    return "expired";
  }
  return row.status;
}

async function ownerOf(db: Database, orgId: string): Promise<string> {
  const [org] = await db
    .select({ owner: orgs.ownerUserId })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);
  if (!org) throw apiErrors.forbidden();
  return org.owner;
}

/** The owner's own records in a grant's scope that the grant has no item for (one per subject). */
function missingQuery(db: Database, orgId: string, ownerId: string, grant: GrantRow) {
  const kinds = grant.scope === "payroll_only" ? ["payroll_line"] : ["payment", "payroll_line"];
  const inPeriod =
    grant.scope === "period" && grant.periodFrom && grant.periodTo
      ? (() => {
          const { from, to } = periodBounds(grant.periodFrom, grant.periodTo);
          return sql`exists (select 1 from ${payments} where ${payments.orgId} = ${orgId} and ${payments.id}::text = ${disclosures.subject} and ${payments.settledAt} >= ${from.toISOString()}::timestamptz and ${payments.settledAt} < ${to.toISOString()}::timestamptz)`;
        })()
      : sql`true`;
  return db
    .selectDistinctOn([disclosures.subject, disclosures.kind])
    .from(disclosures)
    .where(
      and(
        eq(disclosures.orgId, orgId),
        eq(disclosures.viewerUserId, ownerId),
        isNull(disclosures.grantId),
        inArray(disclosures.kind, kinds as ("payment" | "payroll_line")[]),
        sql`not exists (select 1 from ${disclosures} as granted where granted.grant_id = ${grant.id} and granted.subject = ${disclosures.subject} and granted.kind = ${disclosures.kind})`,
        inPeriod,
      ),
    )
    .orderBy(disclosures.subject, disclosures.kind, desc(disclosures.createdAt));
}

async function viewOf(db: Database, row: GrantRow, ownerId: string, now: Date): Promise<GrantView> {
  const status = effectiveStatus(row, now);
  const [viewer, invite, recipient] = await Promise.all([
    row.viewerUserId
      ? db
          .select({
            userId: users.id,
            wallet: users.wallet,
            publicKey: viewerKeys.publicKey,
            signature: viewerKeys.registrationSignature,
          })
          .from(users)
          .leftJoin(
            viewerKeys,
            and(eq(viewerKeys.userId, users.id), eq(viewerKeys.status, "active")),
          )
          .where(eq(users.id, row.viewerUserId))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    db
      .select({ expiresAt: invites.expiresAt, acceptedAt: invites.acceptedAt })
      .from(invites)
      .where(eq(invites.token, row.inviteToken))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    row.scope === "own_payslips" && row.viewerUserId
      ? db
          .select({ name: recipients.displayName, title: recipients.roleTitle })
          .from(recipients)
          .where(and(eq(recipients.orgId, row.orgId), eq(recipients.userId, row.viewerUserId)))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);
  const [items] =
    row.scope === "own_payslips"
      ? await db
          .select({ n: count() })
          .from(disclosures)
          .where(
            and(
              eq(disclosures.orgId, row.orgId),
              eq(disclosures.viewerUserId, row.viewerUserId ?? ownerId),
              isNull(disclosures.grantId),
            ),
          )
      : await db.select({ n: count() }).from(disclosures).where(eq(disclosures.grantId, row.id));
  const missing =
    status === "active" && row.scope !== "own_payslips"
      ? (await missingQuery(db, row.orgId, ownerId, row)).length
      : 0;
  return {
    id: row.id,
    scope: row.scope,
    periodFrom: row.periodFrom,
    periodTo: row.periodTo,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    status,
    holder:
      row.scope === "own_payslips"
        ? { name: recipient?.name ?? "Recipient", title: recipient?.title ?? null }
        : { name: row.holderName ?? "Holder", title: row.holderTitle },
    viewer: viewer
      ? {
          userId: viewer.userId,
          wallet: viewer.wallet,
          viewerKey:
            viewer.publicKey && viewer.signature
              ? {
                  publicKey: Buffer.from(viewer.publicKey).toString("base64"),
                  signature: Buffer.from(viewer.signature).toString("base64"),
                }
              : null,
        }
      : null,
    invite:
      row.scope === "own_payslips" || !invite
        ? null
        : {
            status:
              invite.acceptedAt !== null
                ? "accepted"
                : invite.expiresAt <= now
                  ? "expired"
                  : "pending",
            expiresAt: invite.expiresAt.toISOString(),
          },
    createdAt: row.createdAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    items: items?.n ?? 0,
    missing,
  };
}

async function grantRow(db: Database, orgId: string, grantId: string): Promise<GrantRow> {
  const [row] = await db
    .select()
    .from(grants)
    .where(and(eq(grants.id, grantId), eq(grants.orgId, orgId)))
    .limit(1);
  if (!row) throw grantErrors.notFound();
  return row;
}

function inviteUrl(origin: string, token: string): string {
  return `${origin}/app/invite/${token}`;
}

export async function createGrant(
  db: Database,
  session: Session | null,
  orgId: string,
  input: z.infer<typeof grantCreateSchema>,
  origin: string,
  now = new Date(),
): Promise<{ grant: GrantView; invite: { url: string; expiresAt: string } }> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  if (!session) throw apiErrors.unauthenticated();
  const token = randomBytes(32).toString("base64url");
  const hash = inviteTokenHash(token);
  const inviteExpires = new Date(now.getTime() + INVITE_TTL_MS);
  const expiresAt = expiryFor(input.expiry, now);
  const row = await db.transaction(async (tx) => {
    await tx.insert(invites).values({
      token: hash,
      orgId,
      role: "accountant",
      createdBy: session.userId,
      expiresAt: inviteExpires,
    });
    const [created] = await tx
      .insert(grants)
      .values({
        orgId,
        inviteToken: hash,
        scope: input.scope,
        periodFrom: input.periodFrom ?? null,
        periodTo: input.periodTo ?? null,
        expiresAt,
        status: "pending_viewer_key",
        createdBy: session.userId,
        holderName: input.holderName,
        holderTitle: input.holderTitle ?? null,
      })
      .returning();
    if (!created) throw apiErrors.internal();
    await insertAccessEvent(tx, {
      orgId,
      actorUserId: session.userId,
      action: "grant_created",
      subjectType: "grant",
      subjectId: created.id,
      metadata: {
        scope: input.scope,
        periodFrom: input.periodFrom ?? null,
        periodTo: input.periodTo ?? null,
        expiresAt: expiresAt?.toISOString() ?? null,
        inviteExpiresAt: inviteExpires.toISOString(),
      },
    });
    return created;
  });
  return {
    grant: await viewOf(db, row, await ownerOf(db, orgId), now),
    invite: { url: inviteUrl(origin, token), expiresAt: inviteExpires.toISOString() },
  };
}

export async function listGrants(
  db: Database,
  session: Session | null,
  orgId: string,
  now = new Date(),
): Promise<{ grants: GrantView[]; ownerItems: number }> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  const ownerId = await ownerOf(db, orgId);
  const rows = await db
    .select()
    .from(grants)
    .where(eq(grants.orgId, orgId))
    .orderBy(desc(grants.createdAt))
    .limit(200);
  const [owned] = await db
    .select({ n: count() })
    .from(disclosures)
    .where(
      and(
        eq(disclosures.orgId, orgId),
        eq(disclosures.viewerUserId, ownerId),
        isNull(disclosures.grantId),
        gte(disclosures.createdAt, new Date(now.getTime() - COVERAGE_WINDOW_MS)),
      ),
    );
  return {
    grants: await Promise.all(rows.map((row) => viewOf(db, row, ownerId, now))),
    ownerItems: owned?.n ?? 0,
  };
}

export async function revokeGrant(
  db: Database,
  session: Session | null,
  orgId: string,
  grantId: string,
  now = new Date(),
): Promise<GrantView> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  if (!session) throw apiErrors.unauthenticated();
  const row = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(grants)
      .where(and(eq(grants.id, grantId), eq(grants.orgId, orgId)))
      .for("update")
      .limit(1);
    if (!current) throw grantErrors.notFound();
    if (current.scope === "own_payslips") throw grantErrors.automatic();
    if (current.status === "revoked" || current.status === "expired") {
      throw grantErrors.status(current.status);
    }
    // AC-10.4: the grant's records go in the same transaction.
    const deleted = await tx
      .delete(disclosures)
      .where(eq(disclosures.grantId, current.id))
      .returning({ id: disclosures.id });
    const [revoked] = await tx
      .update(grants)
      .set({ status: "revoked", revokedAt: now })
      .where(eq(grants.id, current.id))
      .returning();
    await insertAccessEvent(tx, {
      orgId,
      actorUserId: session.userId,
      action: "grant_revoked",
      subjectType: "grant",
      subjectId: current.id,
      metadata: { deleted: deleted.length, wasStatus: current.status },
    });
    return revoked ?? current;
  });
  return viewOf(db, row, await ownerOf(db, orgId), now);
}

/** A new link for a grant whose holder has not accepted yet; the old link stops working. */
export async function renewGrantInvite(
  db: Database,
  session: Session | null,
  orgId: string,
  grantId: string,
  origin: string,
  now = new Date(),
): Promise<{ grant: GrantView; invite: { url: string; expiresAt: string } }> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  if (!session) throw apiErrors.unauthenticated();
  const token = randomBytes(32).toString("base64url");
  const hash = inviteTokenHash(token);
  const inviteExpires = new Date(now.getTime() + INVITE_TTL_MS);
  const row = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(grants)
      .where(and(eq(grants.id, grantId), eq(grants.orgId, orgId)))
      .for("update")
      .limit(1);
    if (!current) throw grantErrors.notFound();
    if (current.scope === "own_payslips") throw grantErrors.automatic();
    if (current.viewerUserId !== null) throw grantErrors.inviteAccepted();
    if (effectiveStatus(current, now) !== "pending_viewer_key") {
      throw grantErrors.status(effectiveStatus(current, now));
    }
    await tx.insert(invites).values({
      token: hash,
      orgId,
      role: "accountant",
      createdBy: session.userId,
      expiresAt: inviteExpires,
    });
    const [renewed] = await tx
      .update(grants)
      .set({ inviteToken: hash })
      .where(eq(grants.id, current.id))
      .returning();
    await tx
      .delete(invites)
      .where(and(eq(invites.token, current.inviteToken), isNull(invites.acceptedAt)));
    await insertAccessEvent(tx, {
      orgId,
      actorUserId: session.userId,
      action: "grant_invite_renewed",
      subjectType: "grant",
      subjectId: current.id,
      metadata: { inviteExpiresAt: inviteExpires.toISOString() },
    });
    return renewed ?? current;
  });
  return {
    grant: await viewOf(db, row, await ownerOf(db, orgId), now),
    invite: { url: inviteUrl(origin, token), expiresAt: inviteExpires.toISOString() },
  };
}

/**
 * AC-10.3: the owner's own records in scope that an active grant has none of yet, at most 500 per
 * call (one manifest), with their manifests, so the owner's browser verifies them (I-9), opens them
 * and seals them again to the holder.
 */
export async function backfillItems(
  db: Database,
  session: Session | null,
  orgId: string,
  grantId: string,
  now = new Date(),
) {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  const row = await grantRow(db, orgId, grantId);
  if (row.scope === "own_payslips") throw grantErrors.automatic();
  if (effectiveStatus(row, now) !== "active") {
    throw grantErrors.status(effectiveStatus(row, now));
  }
  const ownerId = await ownerOf(db, orgId);
  const rows = (await missingQuery(db, orgId, ownerId, row)).slice(0, BACKFILL_BATCH);
  const manifestIds = [...new Set(rows.map((item) => item.manifestId))];
  const manifestRows = manifestIds.length
    ? await db.select().from(manifests).where(inArray(manifests.id, manifestIds))
    : [];
  return {
    items: rows.map((item) => ({
      id: item.id,
      grantId: item.grantId,
      kind: item.kind,
      subject: item.subject,
      ciphertext: Buffer.from(item.ciphertext).toString("base64"),
      manifestId: item.manifestId,
      createdAt: item.createdAt.toISOString(),
    })),
    manifests: manifestRows.map((manifest) => ({
      id: manifest.id,
      signerWallet: manifest.signerWallet,
      manifest: manifest.manifest,
      signature: Buffer.from(manifest.signature).toString("base64"),
      createdAt: manifest.createdAt.toISOString(),
    })),
  };
}

/** Active grants a viewer holds in an org, not expired: their items are readable (07 section 7). */
export const readableGrantCondition = (now: Date) =>
  and(
    eq(grants.status, "active"),
    sql`(${grants.expiresAt} is null or ${grants.expiresAt} > ${now.toISOString()}::timestamptz)`,
  );
