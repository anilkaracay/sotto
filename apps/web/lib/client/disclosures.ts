// The viewer's side of I-9 (07 section 4; step 1.10): what GET /api/orgs/:id/disclosures returns is
// trusted only after the browser checked it. Each manifest must name this org and carry the org
// owner wallet's signature, and each item must be listed in its manifest for this viewer with the
// SHA-256 of its exact ciphertext. Only then is the item opened with the viewer's key (in the crypto
// worker), and the payload must be for this org and of the item's kind. Nothing is sent anywhere.
import {
  itemInManifest,
  validateManifest,
  validatePayload,
  verifyManifest,
  type DisclosurePayloadV1,
  type ManifestV1,
} from "@sotto/sdk/disclosure";
import type { DisclosureItemView, ManifestView } from "../server/disclosures.ts";

export type OpenedDisclosure = {
  id: string;
  kind: string;
  createdAt: string;
} & (
  | { state: "opened"; payload: DisclosurePayloadV1 }
  /** Its manifest is missing, malformed or not signed by the owner, or does not list the item. */
  | { state: "unverified" }
  /** Verified, but it does not open with this key or holds no valid payload for this org. */
  | { state: "unreadable" }
);

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export async function openDisclosures(input: {
  orgId: string;
  /** The org owner's wallet: the only valid manifest signer (I-9). */
  ownerWallet: string;
  /** The signed in user, the viewer every item must be listed for. */
  viewerUserId: string;
  items: readonly DisclosureItemView[];
  manifests: readonly ManifestView[];
  /** Opens a sealed box with the viewer's key (the crypto worker's openSealed). */
  open: (ciphertext: Uint8Array) => Promise<unknown>;
}): Promise<OpenedDisclosure[]> {
  const verified = new Map<string, ManifestV1 | null>();
  async function manifestFor(id: string): Promise<ManifestV1 | null> {
    if (verified.has(id)) return verified.get(id) ?? null;
    let result: ManifestV1 | null = null;
    const stored = input.manifests.find((manifest) => manifest.id === id);
    if (stored) {
      try {
        const manifest = validateManifest(stored.manifest);
        const check = await verifyManifest({
          manifest,
          signature: fromBase64(stored.signature),
          ownerWallet: input.ownerWallet,
          org: input.orgId,
        });
        if (check.ok) result = manifest;
      } catch {
        result = null;
      }
    }
    verified.set(id, result);
    return result;
  }

  const opened: OpenedDisclosure[] = [];
  for (const item of input.items) {
    const base = { id: item.id, kind: item.kind, createdAt: item.createdAt };
    const manifest = await manifestFor(item.manifestId);
    const ciphertext = fromBase64(item.ciphertext);
    if (
      !manifest ||
      !(await itemInManifest(manifest, {
        id: item.id,
        viewer: input.viewerUserId,
        ciphertext,
      }))
    ) {
      opened.push({ ...base, state: "unverified" });
      continue;
    }
    try {
      const payload = validatePayload(await input.open(ciphertext));
      opened.push(
        payload.org === input.orgId && payload.kind === item.kind
          ? { ...base, state: "opened", payload }
          : { ...base, state: "unreadable" },
      );
    } catch {
      opened.push({ ...base, state: "unreadable" });
    }
  }
  return opened;
}
