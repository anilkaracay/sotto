// Disclosures (07 sections 3 to 7, 08 section 3; step 1.8). POST stores a batch the owner's browser
// sealed and signed: the manifest must name this org and carry the org owner wallet's signature, list
// exactly the posted items with the SHA-256 of each ciphertext, and every viewer must be allowed by the
// table of 07 section 6: the owner's own items need no grant, every other item names an active grant of
// this org for that viewer whose scope covers the kind (a recipient's payslips come through the
// own_payslips grant its invite created). GET returns the caller's own items with their manifests,
// which the browser verifies again (I-9). Money endpoints (requireMoneyAccess, AC-02.2). The server
// never opens a ciphertext.
import {
  disclosures,
  grants,
  manifests,
  membershipRole,
  orgs,
  users,
  type Database,
} from "@sotto/db";
import {
  DISCLOSURE_KINDS,
  DisclosureError,
  itemInManifest,
  MAX_MANIFEST_ITEMS,
  scopeAllowsKind,
  validateManifest,
  verifyManifest,
} from "@sotto/sdk/disclosure";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { ApiError, apiErrors } from "./errors.ts";
import { requireMoneyAccess } from "./orgs.ts";
import type { Session } from "./session.ts";

/** 500 items of a few hundred bytes each, in base64 with their fields. */
export const DISCLOSURE_MAX_BODY_BYTES = 1_048_576;

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

export async function createDisclosures(
  db: Database,
  session: Session | null,
  orgId: string,
  input: z.infer<typeof disclosurePostSchema>,
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

  // Every viewer must be allowed (07 section 6): the owner, or an active grant that covers the kind.
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
        })
        .from(grants)
        .where(and(eq(grants.orgId, orgId), inArray(grants.id, grantIds)))
    : [];
  for (const item of input.items) {
    if (item.grantId === null) {
      if (item.viewerUserId !== owner.userId) throw disclosureErrors.notAllowed();
      continue;
    }
    const grant = grantRows.find((row) => row.id === item.grantId);
    if (
      !grant ||
      grant.viewer !== item.viewerUserId ||
      grant.status !== "active" ||
      !scopeAllowsKind(grant.scope, item.kind)
    ) {
      throw disclosureErrors.notAllowed();
    }
  }

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
    return { manifestId: stored.id, count: inserted.length };
  });
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
): Promise<{ items: DisclosureItemView[]; manifests: ManifestView[] }> {
  await requireMoneyAccess(db, session, orgId, [...membershipRole.enumValues]);
  if (!session) throw apiErrors.unauthenticated();
  const rows = await db
    .select()
    .from(disclosures)
    .where(
      and(
        eq(disclosures.orgId, orgId),
        eq(disclosures.viewerUserId, session.userId),
        query.kind ? eq(disclosures.kind, query.kind) : undefined,
        query.from
          ? gte(disclosures.createdAt, new Date(`${query.from}T00:00:00.000Z`))
          : undefined,
        query.to ? lt(disclosures.createdAt, new Date(`${query.to}T00:00:00.000Z`)) : undefined,
      ),
    )
    .orderBy(asc(disclosures.createdAt))
    .limit(1000);
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
