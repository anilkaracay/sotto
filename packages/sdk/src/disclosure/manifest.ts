// Signed manifests (07 section 4, I-9): each batch of disclosures the owner's browser creates is listed
// in a manifest, canonical JSON of { v, org, items: [{ id, viewer, sha256_ciphertext }], created_at },
// and the owner wallet signs `sotto-disclosure-manifest/v1\n` followed by the SHA-256 of that JSON in
// lowercase hex. A viewer, and the server before it stores anything, trusts an item only if the
// manifest is signed by the org owner's wallet, names this org, and lists the item's id and viewer with
// the SHA-256 of its exact ciphertext. No libsodium here: servers verify with WebCrypto and kit.
import { verifyWalletSignature } from "../keys/signatures.ts";
import { canonicalJsonBytes } from "./canonical.ts";
import { DisclosureError, UUID } from "./payload.ts";

export const MANIFEST_PREFIX = "sotto-disclosure-manifest/v1\n";
/** Items per manifest: a payroll chunk or a back fill page. */
export const MAX_MANIFEST_ITEMS = 500;

export type ManifestItem = { id: string; viewer: string; sha256_ciphertext: string };
export type ManifestV1 = { v: 1; org: string; items: ManifestItem[]; created_at: string };

const HEX_64 = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildManifest(input: {
  org: string;
  createdAt: string;
  items: { id: string; viewer: string; ciphertext: Uint8Array }[];
}): Promise<ManifestV1> {
  return validateManifest({
    v: 1,
    org: input.org,
    items: await Promise.all(
      input.items.map(async (item) => ({
        id: item.id,
        viewer: item.viewer,
        sha256_ciphertext: await sha256Hex(item.ciphertext),
      })),
    ),
    created_at: input.createdAt,
  });
}

/** A version 1 manifest, exactly: uuids, lowercase hex hashes, unique item ids, nothing else. */
export function validateManifest(value: unknown): ManifestV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DisclosureError("the manifest must be an object");
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort().join(",");
  if (keys !== "created_at,items,org,v") {
    throw new DisclosureError("the manifest has exactly v, org, items and created_at");
  }
  if (input.v !== 1) throw new DisclosureError("the manifest version must be 1");
  if (typeof input.org !== "string" || !UUID.test(input.org)) {
    throw new DisclosureError("the manifest org must be a uuid");
  }
  if (typeof input.created_at !== "string" || !ISO_UTC.test(input.created_at)) {
    throw new DisclosureError("created_at must be an ISO 8601 UTC time");
  }
  if (
    !Array.isArray(input.items) ||
    input.items.length === 0 ||
    input.items.length > MAX_MANIFEST_ITEMS
  ) {
    throw new DisclosureError(`a manifest lists 1 to ${MAX_MANIFEST_ITEMS} items`);
  }
  const ids = new Set<string>();
  const items = input.items.map((raw: unknown) => {
    const item = raw as Record<string, unknown>;
    if (
      typeof item !== "object" ||
      item === null ||
      Object.keys(item).sort().join(",") !== "id,sha256_ciphertext,viewer" ||
      typeof item.id !== "string" ||
      !UUID.test(item.id) ||
      typeof item.viewer !== "string" ||
      !UUID.test(item.viewer) ||
      typeof item.sha256_ciphertext !== "string" ||
      !HEX_64.test(item.sha256_ciphertext)
    ) {
      throw new DisclosureError("a manifest item has exactly a uuid id, a uuid viewer and a hash");
    }
    if (ids.has(item.id)) throw new DisclosureError("manifest item ids must be unique");
    ids.add(item.id);
    return { id: item.id, viewer: item.viewer, sha256_ciphertext: item.sha256_ciphertext };
  });
  return { v: 1, org: input.org, items, created_at: input.created_at };
}

/** The bytes the owner wallet signs for a manifest. */
export async function manifestMessage(manifest: ManifestV1): Promise<Uint8Array> {
  const digest = await sha256Hex(canonicalJsonBytes(manifest));
  return new TextEncoder().encode(`${MANIFEST_PREFIX}${digest}`);
}

export type ManifestCheck = { ok: true } | { ok: false; reason: "wrong_org" | "bad_signature" };

/** I-9: the manifest names this org and carries the org owner wallet's signature. */
export async function verifyManifest(input: {
  manifest: ManifestV1;
  signature: Uint8Array;
  ownerWallet: string;
  org: string;
}): Promise<ManifestCheck> {
  if (input.manifest.org !== input.org) return { ok: false, reason: "wrong_org" };
  const valid = await verifyWalletSignature(
    input.ownerWallet,
    await manifestMessage(input.manifest),
    input.signature,
  );
  return valid ? { ok: true } : { ok: false, reason: "bad_signature" };
}

/** Whether the manifest lists this item: its id, its viewer and the SHA-256 of its exact ciphertext. */
export async function itemInManifest(
  manifest: ManifestV1,
  item: { id: string; viewer: string; ciphertext: Uint8Array },
): Promise<boolean> {
  const entry = manifest.items.find((candidate) => candidate.id === item.id);
  return (
    entry !== undefined &&
    entry.viewer === item.viewer &&
    entry.sha256_ciphertext === (await sha256Hex(item.ciphertext))
  );
}
