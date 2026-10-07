// Organizations (F-02, 08 sections 2 and 3): creation with the KYB fields, the members' view, the
// owner's edits, the Sotto admin review and the money gate. One org per owner wallet, because the
// owner wallet is the attestation nonce (08 section 5).
import { admins, memberships, orgPolicy, orgs, users, type Database } from "@sotto/db";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import {
  moneyEnabled,
  REVIEWED_FIELDS,
  type OrgCreate,
  type OrgStatus,
  type OrgUpdate,
} from "../org.ts";
import { ApiError, apiErrors } from "./errors.ts";
import { requireMembership, type Role } from "./membership.ts";
import type { Session } from "./session.ts";
import type { AssetId } from "@sotto/sdk/cluster/assets";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const orgColumns = {
  id: orgs.id,
  displayName: orgs.displayName,
  legalName: orgs.legalName,
  country: orgs.country,
  registrationNo: orgs.registrationNo,
  website: orgs.website,
  contactEmail: orgs.contactEmail,
  status: orgs.status,
  asset: orgs.asset,
  attestationAddress: orgs.attestationAddress,
  reviewedAt: orgs.reviewedAt,
  createdAt: orgs.createdAt,
};

export type OrgView = {
  id: string;
  displayName: string;
  legalName: string;
  country: string;
  registrationNo: string;
  website: string;
  contactEmail: string;
  status: OrgStatus;
  /** The organization's asset (step 4.3, D-29), fixed at creation. */
  asset: AssetId;
  attestationAddress: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
};

export type AdminOrgView = OrgView & { ownerWallet: string; reviewedBy: string | null };

const STATUS_WORD: Record<OrgStatus, string> = {
  pending_review: "in review",
  active: "active",
  suspended: "suspended",
};

export type AdminAction = "approve" | "reject" | "suspend";

// Reject has no status of its own in the hackathon build: a rejected org is suspended
// (D-09).
const TRANSITIONS: Record<
  AdminAction,
  { from: OrgStatus; to: OrgStatus; fromLabel: string; done: string }
> = {
  approve: { from: "pending_review", to: "active", fromLabel: "in review", done: "approved" },
  reject: { from: "pending_review", to: "suspended", fromLabel: "in review", done: "rejected" },
  suspend: { from: "active", to: "suspended", fromLabel: "active", done: "suspended" },
};

export const orgErrors = {
  exists: () => new ApiError(409, "org_exists", "This wallet already has an organization"),
  reviewedFieldsLocked: () =>
    new ApiError(
      409,
      "org_details_locked",
      "The legal name, country, registration number and website can change only while the organization is in review",
    ),
  notFound: () => new ApiError(404, "org_not_found", "Organization not found"),
  assetUnavailable: () =>
    new ApiError(422, "asset_unavailable", "This currency is not available on this network"),
  statusConflict: (action: AdminAction, status: OrgStatus) =>
    new ApiError(
      409,
      "org_status_conflict",
      `Only ${TRANSITIONS[action].fromLabel} organizations can be ${TRANSITIONS[action].done}; this one is ${STATUS_WORD[status]}`,
    ),
  notActive: (status: OrgStatus) =>
    new ApiError(
      403,
      "org_not_active",
      status === "pending_review"
        ? "Money features open once Sotto verifies the organization"
        : "Money features are disabled while the organization is not verified",
    ),
};

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: { code?: string; constraint_name?: string } } | null)?.cause;
  return cause?.code === "23505" && cause.constraint_name === constraint;
}

/** AC-02.1: the org starts in review, its creator becomes Owner, its policy gets the defaults. */
export async function createOrg(db: Database, userId: string, fields: OrgCreate): Promise<OrgView> {
  try {
    return await db.transaction(async (tx) => {
      const [org] = await tx
        .insert(orgs)
        .values({
          ...fields,
          displayName: fields.displayName ?? fields.legalName,
          ownerUserId: userId,
        })
        .returning(orgColumns);
      if (!org) throw new Error("org insert returned no row");
      await tx.insert(memberships).values({ orgId: org.id, userId, role: "owner" });
      await tx.insert(orgPolicy).values({ orgId: org.id });
      return org;
    });
  } catch (error) {
    if (isUniqueViolation(error, "orgs_owner_user_id_key")) throw orgErrors.exists();
    throw error;
  }
}

/** The org the user owns, if any (at most one). */
export async function ownedOrg(db: Database, userId: string): Promise<OrgView | null> {
  const [org] = await db.select(orgColumns).from(orgs).where(eq(orgs.ownerUserId, userId)).limit(1);
  return org ?? null;
}

/** GET /orgs/:id: any active member reads the org. */
export async function readOrg(
  db: Database,
  session: Session | null,
  orgId: string,
): Promise<{ org: OrgView; roles: Role[] }> {
  const { roles } = await requireMembership(db, session, orgId, [
    "owner",
    "approver",
    "accountant",
    "board",
    "recipient",
  ]);
  const [org] = await db.select(orgColumns).from(orgs).where(eq(orgs.id, orgId)).limit(1);
  if (!org) throw apiErrors.forbidden();
  return { org, roles };
}

/** PATCH /orgs/:id (owner): the reviewed fields change only while the org is in review. */
export async function updateOrg(
  db: Database,
  session: Session | null,
  orgId: string,
  changes: OrgUpdate,
): Promise<OrgView> {
  await requireMembership(db, session, orgId, ["owner"]);
  const touchesReviewed = REVIEWED_FIELDS.some((field) => changes[field] !== undefined);
  const where: SQL[] = [eq(orgs.id, orgId)];
  if (touchesReviewed) where.push(eq(orgs.status, "pending_review"));
  const [org] = await db
    .update(orgs)
    .set(changes)
    .where(and(...where))
    .returning(orgColumns);
  if (!org) throw touchesReviewed ? orgErrors.reviewedFieldsLocked() : apiErrors.forbidden();
  return org;
}

/** Sotto admins are the rows of the admins table (08 section 2). */
export async function requireAdmin(
  db: Database,
  session: Session | null,
): Promise<{ wallet: string }> {
  if (!session) throw apiErrors.unauthenticated();
  const [row] = await db
    .select({ wallet: admins.wallet })
    .from(users)
    .innerJoin(admins, eq(admins.wallet, users.wallet))
    .where(eq(users.id, session.userId))
    .limit(1);
  if (!row) throw apiErrors.forbidden();
  return row;
}

export const ADMIN_LIST_LIMIT = 200;

/** GET /admin/orgs?status=: oldest first, so the review queue reads top down. */
export async function listOrgsForAdmin(
  db: Database,
  status: OrgStatus | null,
): Promise<{ orgs: AdminOrgView[]; truncated: boolean }> {
  const rows = await db
    .select({ ...orgColumns, ownerWallet: users.wallet, reviewedBy: orgs.reviewedBy })
    .from(orgs)
    .innerJoin(users, eq(users.id, orgs.ownerUserId))
    .where(status ? eq(orgs.status, status) : undefined)
    .orderBy(asc(orgs.createdAt), asc(orgs.id))
    .limit(ADMIN_LIST_LIMIT + 1);
  return { orgs: rows.slice(0, ADMIN_LIST_LIMIT), truncated: rows.length > ADMIN_LIST_LIMIT };
}

/**
 * Applies an admin decision in one conditional update and records who decided and when. The
 * worker's sas-issue job then issues the attestation of an approved org (AC-02.3) or closes the
 * attestation of a suspended one (AC-02.4).
 */
export async function decideOrg(
  db: Database,
  orgId: string,
  action: AdminAction,
  adminWallet: string,
): Promise<AdminOrgView> {
  if (!UUID.test(orgId)) throw orgErrors.notFound();
  const transition = TRANSITIONS[action];
  const [updated] = await db
    .update(orgs)
    .set({ status: transition.to, reviewedBy: adminWallet, reviewedAt: sql`now()` })
    .where(and(eq(orgs.id, orgId), eq(orgs.status, transition.from)))
    .returning({ id: orgs.id });
  const [row] = await db
    .select({ ...orgColumns, ownerWallet: users.wallet, reviewedBy: orgs.reviewedBy })
    .from(orgs)
    .innerJoin(users, eq(users.id, orgs.ownerUserId))
    .where(eq(orgs.id, orgId))
    .limit(1);
  if (!row) throw orgErrors.notFound();
  if (!updated) throw orgErrors.statusConflict(action, row.status);
  return row;
}

/**
 * The money gate (AC-02.2, AC-02.4): every money endpoint (F-03 to F-09) calls this instead of
 * requireMembership alone. Non members get 403 forbidden before the org status is looked at.
 */
export async function requireMoneyAccess(
  db: Database,
  session: Session | null,
  orgId: string,
  roles: readonly Role[],
): Promise<{ roles: Role[] }> {
  const access = await requireMembership(db, session, orgId, roles);
  const [org] = await db
    .select({ status: orgs.status })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);
  if (!org) throw apiErrors.forbidden();
  if (!moneyEnabled(org.status)) throw orgErrors.notActive(org.status);
  return access;
}
