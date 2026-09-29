// Disclosures (07 sections 3 to 7, 08 section 3; step 1.8). POST stores a batch the owner's browser
// sealed and signed: the manifest must name this org and carry the org owner wallet's signature, list
// exactly the posted items with the SHA-256 of each ciphertext, and every viewer must be allowed:
// without a grant, the owner's own items (07 section 6) and a current recipient's disclosures of a
// payment or payslip line (AC-06.4, AC-12.1); with a grant, an active grant of this org for that viewer
// whose scope covers the kind. Since step 2.4 an item's subject must be what its viewer may see: a
// recipient's item a payment to that recipient, a grant's item a payment the scope covers (a period
// grant: settled in its period; own payslips: the viewer's own line), and an expired grant covers
// nothing; each batch is written to the access log (a back fill when it holds only one grant's items).
// GET returns the caller's own items with their manifests, which the browser verifies again (I-9),
// never the items of a grant that is not active or has expired, and records the viewer's last use of
// their grants. Money endpoints (requireMoneyAccess, AC-02.2). The server never opens a ciphertext.
import {
  disclosures,
  grants,
  insertAccessEvent,
  manifests,
  memberships,
  membershipRole,
  orgs,
  payments,
  recipients,
  users,
  type Database,
} from "@sotto/db";
import {
  DISCLOSURE_KINDS,
  DisclosureError,
  itemInManifest,
  MAX_MANIFEST_ITEMS,
  scopeCovers,
  validateManifest,
  verifyManifest,
  type DisclosureKind,
} from "@sotto/sdk/disclosure";
import { and, asc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { ApiError, apiErrors } from "./errors.ts";
import { readableGrantCondition } from "./grants.ts";
import { requireMoneyAccess } from "./orgs.ts";
import type { Session } from "./session.ts";

/** 500 items of a few hundred bytes each, in base64 with their fields. */
export const DISCLOSURE_MAX_BODY_BYTES = 1_048_576;

/**
 * What a recipient of the org receives without a grant: the recipient disclosure of a payment to them
 * (AC-06.4) and their payslip lines (AC-12.1); never org level items such as balance snapshots.
 */
const RECIPIENT_KINDS: readonly DisclosureKind[] = ["payment", "payroll_line"];

const base64Of = (min: number, max: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, "must be base64")
    .refine((value) => {
      const bytes = Buffer.from(value, "base64");
      return bytes.length >= min && bytes.length <= max && bytes.toString("base64") === value;
    }, `must be ${min} to ${max} bytes in base64`);

export const disclosurePostSchema = z
  .object({
    manifest: z.unknown(),
    signature: base64Of(64, 64),
    items: z
      .array(
        z
          .object({
            id: z.uuid(),
            viewerUserId: z.uuid(),
            grantId: z.uuid().nullable(),
            kind: z.enum(DISCLOSURE_KINDS),
            subject: z.string().min(1).max(100),
            ciphertext: base64Of(48, 16_384),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_MANIFEST_ITEMS),
  })
  .strict();

export const disclosureQuerySchema = z
  .object({
    kind: z.enum(DISCLOSURE_KINDS).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .strict();

export const disclosureErrors = {
  manifest: (message: string) => new ApiError(422, "manifest_invalid", message),
  mismatch: () =>
    new ApiError(422, "disclosure_mismatch", "The items do not match the signed manifest"),
  notAllowed: () =>
    new ApiError(
      422,
      "disclosure_not_allowed",
      "An item is for a viewer or a kind this organization does not share with",
    ),
  exists: () => new ApiError(409, "disclosure_exists", "An item with this id already exists"),
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Subject = {
  kind: "single" | "payroll_line";
  status: string;
  settledAt: Date | null;
  recipientUser: string | null;
};

/** The payments of this org that items name as their subject (payment and payroll line ids). */
async function subjectsOf(
  db: Database,
  orgId: string,
  subjects: string[],
): Promise<Map<string, Subject>> {
  const ids = [...new Set(subjects.filter((subject) => UUID.test(subject)))];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: payments.id,
      kind: payments.kind,
      status: payments.status,
      settledAt: payments.settledAt,
      recipientUser: recipients.userId,
    })
    .from(payments)
    .innerJoin(recipients, eq(recipients.id, payments.recipientId))
    .where(and(eq(payments.orgId, orgId), inArray(payments.id, ids)));
  return new Map(rows.map((row) => [row.id, row]));
}

/** An item's kind names its subject's kind: a single payment or a payroll line of this org. */
function subjectMatches(kind: DisclosureKind, subject: Subject | undefined): subject is Subject {
  if (!subject) return false;
  return (
    (kind === "payment" && subject.kind === "single") ||
    (kind === "payroll_line" && subject.kind === "payroll_line")
  );
}

export async function createDisclosures(
  db: Database,
  session: Session | null,
  orgId: string,
  input: z.infer<typeof disclosurePostSchema>,
  now = new Date(),
): Promise<{ manifestId: string; count: number }> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  if (!session) throw apiErrors.unauthenticated();
  let manifest;
  try {
    manifest = validateManifest(input.manifest);
  } catch (error) {
    throw apiErrors.invalidRequest(
      `Invalid request: manifest: ${error instanceof DisclosureError ? error.message : "invalid"}`,
    );
  }
  const [owner] = await db
    .select({ userId: orgs.ownerUserId, wallet: users.wallet })
    .from(orgs)
    .innerJoin(users, eq(users.id, orgs.ownerUserId))
    .where(eq(orgs.id, orgId))
    .limit(1);
  if (!owner) throw apiErrors.forbidden();
  const check = await verifyManifest({
    manifest,
    signature: new Uint8Array(Buffer.from(input.signature, "base64")),
    ownerWallet: owner.wallet,
    org: orgId,
  });
  if (!check.ok) {
    throw disclosureErrors.manifest(
      check.reason === "wrong_org"
        ? "The manifest names another organization"
        : "The manifest is not signed by the organization owner's wallet",
    );
  }
  if (
    manifest.items.length !== input.items.length ||
    new Set(input.items.map((item) => item.id)).size !== input.items.length
  ) {
    throw disclosureErrors.mismatch();
  }
  const ciphertexts = new Map<string, Uint8Array>();
  for (const item of input.items) {
    const ciphertext = new Uint8Array(Buffer.from(item.ciphertext, "base64"));
    ciphertexts.set(item.id, ciphertext);
    if (!(await itemInManifest(manifest, { id: item.id, viewer: item.viewerUserId, ciphertext }))) {
      throw disclosureErrors.mismatch();
    }
  }

  // Every viewer must be allowed: the owner, a current recipient for the recipient kinds, or an active
  // grant that covers the kind.
  const grantIds = [
    ...new Set(input.items.flatMap((item) => (item.grantId ? [item.grantId] : []))),
  ];
  const grantRows = grantIds.length
    ? await db
        .select({
          id: grants.id,
          viewer: grants.viewerUserId,
          scope: grants.scope,
          status: grants.status,
          periodFrom: grants.periodFrom,
          periodTo: grants.periodTo,
          expiresAt: grants.expiresAt,
        })
        .from(grants)
        .where(and(eq(grants.orgId, orgId), inArray(grants.id, grantIds)))
    : [];
  const subjects = await subjectsOf(
    db,
    orgId,
    input.items.filter((item) => item.viewerUserId !== owner.userId).map((item) => item.subject),
  );
  const recipientViewers = [
    ...new Set(
      input.items
        .filter((item) => item.grantId === null && item.viewerUserId !== owner.userId)
        .map((item) => item.viewerUserId),
    ),
  ];
  const recipientRows = recipientViewers.length
    ? await db
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.orgId, orgId),
            eq(memberships.role, "recipient"),
            isNull(memberships.removedAt),
            inArray(memberships.userId, recipientViewers),
          ),
        )
    : [];
  const recipientsOfOrg = new Set(recipientRows.map((row) => row.userId));
  for (const item of input.items) {
    if (item.grantId === null) {
      if (item.viewerUserId === owner.userId) continue;
      // A recipient's item is about a payment to that recipient (step 2.4).
      const subject = subjects.get(item.subject);
      if (
        !recipientsOfOrg.has(item.viewerUserId) ||
        !RECIPIENT_KINDS.includes(item.kind) ||
        !subjectMatches(item.kind, subject) ||
        subject.recipientUser !== item.viewerUserId
      ) {
        throw disclosureErrors.notAllowed();
      }
      continue;
    }
    const grant = grantRows.find((row) => row.id === item.grantId);
    if (
      !grant ||
      grant.viewer !== item.viewerUserId ||
      grant.status !== "active" ||
      (grant.expiresAt !== null && grant.expiresAt <= now)
    ) {
      throw disclosureErrors.notAllowed();
    }
    // Step 2.4: the scope covers the item's subject, a payment of this org that settled or is being
    // disclosed as it settles (06 section 9: disclosures follow finality).
    const subject = subjects.get(item.subject);
    if (!subjectMatches(item.kind, subject) || !["settled", "executing"].includes(subject.status)) {
      throw disclosureErrors.notAllowed();
    }
    if (
      !scopeCovers(grant, {
        kind: item.kind,
        settledAt: subject.settledAt ?? now,
        ownLine: subject.recipientUser === item.viewerUserId,
      })
    ) {
      throw disclosureErrors.notAllowed();
    }
  }
  const backfill =
    input.items.every((item) => item.grantId !== null) &&
    new Set(input.items.map((item) => item.grantId)).size === 1;

  return db.transaction(async (tx) => {
    const [stored] = await tx
      .insert(manifests)
      .values({
        orgId,
        signerWallet: owner.wallet,
        manifest,
        signature: Buffer.from(input.signature, "base64"),
      })
      .returning({ id: manifests.id });
    if (!stored) throw apiErrors.internal();
    const inserted = await tx
      .insert(disclosures)
      .values(
        input.items.map((item) => ({
          id: item.id,
          orgId,
          grantId: item.grantId,
          viewerUserId: item.viewerUserId,
          kind: item.kind,
          subject: item.subject,
          ciphertext: Buffer.from(ciphertexts.get(item.id) ?? new Uint8Array()),
          manifestId: stored.id,
        })),
      )
      .onConflictDoNothing({ target: disclosures.id })
      .returning({ id: disclosures.id });
    if (inserted.length !== input.items.length) throw disclosureErrors.exists();
    // AC-14.1: the batch, metadata only (counts and kinds, never a payload).
    const firstGrant = input.items[0]?.grantId ?? null;
    await insertAccessEvent(tx, {
      orgId,
      actorUserId: session.userId,
      action: backfill ? "grant_backfilled" : "disclosure_batch_created",
      subjectType: backfill ? "grant" : "manifest",
      subjectId: backfill && firstGrant ? firstGrant : stored.id,
      metadata: {
        manifestId: stored.id,
        items: inserted.length,
        kinds: [...new Set(input.items.map((item) => item.kind))],
        viewers: new Set(input.items.map((item) => item.viewerUserId)).size,
        grants: grantIds.length,
      },
    });
    return { manifestId: stored.id, count: inserted.length };
  });
}

/**
 * The wallet of the org's owner, the only valid manifest signer (I-9): the recipient's page checks
 * every manifest against it before it opens anything. Null for an unknown org.
 */
export async function orgOwnerWallet(db: Database, orgId: string): Promise<string | null> {
  const [owner] = await db
    .select({ wallet: users.wallet })
    .from(orgs)
    .innerJoin(users, eq(users.id, orgs.ownerUserId))
    .where(eq(orgs.id, orgId))
    .limit(1);
  return owner?.wallet ?? null;
}

export type DisclosureItemView = {
  id: string;
  grantId: string | null;
  kind: string;
  subject: string;
  ciphertext: string;
  manifestId: string;
  createdAt: string;
};

export type ManifestView = {
  id: string;
  signerWallet: string;
  manifest: unknown;
  signature: string;
  createdAt: string;
};

/** The caller's own items in this org (at most 1000, oldest first) with their manifests. */
export async function listDisclosures(
  db: Database,
  session: Session | null,
  orgId: string,
  query: z.infer<typeof disclosureQuerySchema>,
  now = new Date(),
): Promise<{ items: DisclosureItemView[]; manifests: ManifestView[] }> {
  await requireMoneyAccess(db, session, orgId, [...membershipRole.enumValues]);
  if (!session) throw apiErrors.unauthenticated();
  const found = await db
    .select({ disclosure: disclosures })
    .from(disclosures)
    .leftJoin(grants, eq(grants.id, disclosures.grantId))
    .where(
      and(
        eq(disclosures.orgId, orgId),
        eq(disclosures.viewerUserId, session.userId),
        // 07 section 7: a grant that is not active or has expired opens nothing, even before the
        // worker's grant-expiry job deletes its items.
        or(isNull(disclosures.grantId), readableGrantCondition(now)),
        query.kind ? eq(disclosures.kind, query.kind) : undefined,
        query.from
          ? gte(disclosures.createdAt, new Date(`${query.from}T00:00:00.000Z`))
          : undefined,
        query.to ? lt(disclosures.createdAt, new Date(`${query.to}T00:00:00.000Z`)) : undefined,
      ),
    )
    .orderBy(asc(disclosures.createdAt))
    .limit(1000);
  const rows = found.map((row) => row.disclosure);
  // X-24: a viewer's successful fetch is the last use of their active grants in this org.
  await db
    .update(grants)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(grants.orgId, orgId),
        eq(grants.viewerUserId, session.userId),
        eq(grants.status, "active"),
      ),
    );
  const manifestIds = [...new Set(rows.map((row) => row.manifestId))];
  const manifestRows = manifestIds.length
    ? await db.select().from(manifests).where(inArray(manifests.id, manifestIds))
    : [];
  return {
    items: rows.map((row) => ({
      id: row.id,
      grantId: row.grantId,
      kind: row.kind,
      subject: row.subject,
      ciphertext: Buffer.from(row.ciphertext).toString("base64"),
      manifestId: row.manifestId,
      createdAt: row.createdAt.toISOString(),
    })),
    manifests: manifestRows.map((row) => ({
      id: row.id,
      signerWallet: row.signerWallet,
      manifest: row.manifest,
      signature: Buffer.from(row.signature).toString("base64"),
      createdAt: row.createdAt.toISOString(),
    })),
  };
}
