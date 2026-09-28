// Viewer keys (07 section 5, 08 section 3). A user registers the X25519 public key of their viewing key
// together with their wallet's signature of `sotto-view-key-register/v1\n<base64 key>`. The server
// checks the signature before storing, so it can prove the wallet published the key, and returns the
// signature with the key, so browsers check it again before encrypting to it (I-8). Registering a new
// key marks the previous one `rotated`.
import { grants, memberships, users, viewerKeys, type Database } from "@sotto/db";
import { verifyViewKeyRegistration } from "@sotto/sdk/keys/public";
import { and, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { ApiError, apiErrors } from "./errors.ts";
import type { Session } from "./session.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Base64 (RFC 4648, with padding) of exactly `length` bytes, decoded. */
function base64Bytes(field: string, length: number) {
  return z
    .string(`${field} must be base64`)
    .refine(
      (value) =>
        /^[A-Za-z0-9+/]*={0,2}$/.test(value) &&
        Buffer.from(value, "base64").toString("base64") === value &&
        Buffer.from(value, "base64").length === length,
      `${field} must be ${length} bytes in base64`,
    )
    .transform((value) => new Uint8Array(Buffer.from(value, "base64")));
}

export const viewerKeyRegistrationSchema = z
  .object({ publicKey: base64Bytes("publicKey", 32), signature: base64Bytes("signature", 64) })
  .strict();

export type ViewerKeyView = {
  id: string;
  userId: string;
  wallet: string;
  publicKey: string;
  signature: string;
  status: "active" | "rotated";
  createdAt: Date;
};

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

export const viewerKeyErrors = {
  signatureInvalid: () =>
    new ApiError(
      400,
      "viewer_key_signature_invalid",
      "The signature is not this wallet's signature of the viewing key registration",
    ),
  conflict: () =>
    new ApiError(
      409,
      "viewer_key_conflict",
      "Another viewing key registration finished first; retry",
    ),
  notFound: () => new ApiError(404, "viewer_key_not_found", "This user has no viewing key yet"),
};

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: { code?: string; constraint_name?: string } } | null)?.cause;
  return cause?.code === "23505" && cause.constraint_name === constraint;
}

async function walletOf(db: Database, userId: string): Promise<string> {
  const [user] = await db
    .select({ wallet: users.wallet })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw apiErrors.unauthenticated();
  return user.wallet;
}

/** POST /viewer-keys: 201 with the new key, or 200 when the same key is already active. */
export async function registerViewerKey(
  db: Database,
  session: Session,
  input: { publicKey: Uint8Array; signature: Uint8Array },
): Promise<{ viewerKey: ViewerKeyView; created: boolean }> {
  const wallet = await walletOf(db, session.userId);
  if (!(await verifyViewKeyRegistration({ wallet, ...input }))) {
    throw viewerKeyErrors.signatureInvalid();
  }
  const view = (row: typeof viewerKeys.$inferSelect): ViewerKeyView => ({
    id: row.id,
    userId: row.userId,
    wallet,
    publicKey: b64(row.publicKey),
    signature: b64(row.registrationSignature),
    status: row.status,
    createdAt: row.createdAt,
  });
  try {
    return await db.transaction(async (tx) => {
      const [active] = await tx
        .select()
        .from(viewerKeys)
        .where(and(eq(viewerKeys.userId, session.userId), eq(viewerKeys.status, "active")))
        .limit(1);
      if (active && Buffer.from(active.publicKey).equals(Buffer.from(input.publicKey))) {
        return { viewerKey: view(active), created: false };
      }
      if (active) {
        await tx.update(viewerKeys).set({ status: "rotated" }).where(eq(viewerKeys.id, active.id));
      }
      const [row] = await tx
        .insert(viewerKeys)
        .values({
          userId: session.userId,
          publicKey: input.publicKey,
          registrationSignature: input.signature,
        })
        .returning();
      if (!row) throw new Error("viewer key insert returned no row");
      // 07 section 5: grants waiting for this user's viewing key become active (step 1.8).
      await tx
        .update(grants)
        .set({ status: "active" })
        .where(
          and(eq(grants.viewerUserId, session.userId), eq(grants.status, "pending_viewer_key")),
        );
      return { viewerKey: view(row), created: true };
    });
  } catch (error) {
    if (isUniqueViolation(error, "viewer_keys_one_active_per_user"))
      throw viewerKeyErrors.conflict();
    throw error;
  }
}

/**
 * GET /users/:id/viewer-key: the active key of a user, for that user or for an owner of an org the user
 * is an active member of (the owner's browser encrypts disclosures to members, 07 section 6).
 */
export async function readViewerKey(
  db: Database,
  session: Session,
  userId: string,
): Promise<ViewerKeyView> {
  if (!UUID.test(userId)) throw apiErrors.forbidden();
  if (userId !== session.userId) {
    const owner = alias(memberships, "owner_membership");
    const [shared] = await db
      .select({ orgId: memberships.orgId })
      .from(memberships)
      .innerJoin(owner, eq(owner.orgId, memberships.orgId))
      .where(
        and(
          eq(memberships.userId, userId),
          isNull(memberships.removedAt),
          eq(owner.userId, session.userId),
          eq(owner.role, "owner"),
          isNull(owner.removedAt),
        ),
      )
      .limit(1);
    if (!shared) throw apiErrors.forbidden();
  }
  const [row] = await db
    .select({
      id: viewerKeys.id,
      userId: viewerKeys.userId,
      wallet: users.wallet,
      publicKey: viewerKeys.publicKey,
      signature: viewerKeys.registrationSignature,
      status: viewerKeys.status,
      createdAt: viewerKeys.createdAt,
    })
    .from(viewerKeys)
    .innerJoin(users, eq(users.id, viewerKeys.userId))
    .where(and(eq(viewerKeys.userId, userId), eq(viewerKeys.status, "active")))
    .orderBy(desc(viewerKeys.createdAt))
    .limit(1);
  if (!row) throw viewerKeyErrors.notFound();
  return { ...row, publicKey: b64(row.publicKey), signature: b64(row.signature) };
}
