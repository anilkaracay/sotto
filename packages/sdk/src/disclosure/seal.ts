// Sealed boxes (07 section 2): `crypto_box_seal` to a viewer's X25519 public key (anonymous sender;
// the manifest authenticates the batch) and `crypto_box_seal_open` with the viewer's keypair, over the
// canonical JSON of a value. Libsodium is heavy, so pages load this only in the crypto worker; the
// server never opens anything.
import sodium from "libsodium-wrappers-sumo";
import { canonicalJsonBytes } from "./canonical.ts";
import { DisclosureError, validatePayload, type DisclosurePayloadV1 } from "./payload.ts";

export async function sealJson(value: unknown, viewerPublicKey: Uint8Array): Promise<Uint8Array> {
  if (viewerPublicKey.length !== 32) throw new DisclosureError("a viewer key is 32 bytes");
  await sodium.ready;
  return sodium.crypto_box_seal(canonicalJsonBytes(value), viewerPublicKey);
}

export async function openJson(
  ciphertext: Uint8Array,
  viewer: { publicKey: Uint8Array; secretKey: Uint8Array },
): Promise<unknown> {
  await sodium.ready;
  let plaintext: Uint8Array;
  try {
    plaintext = sodium.crypto_box_seal_open(ciphertext, viewer.publicKey, viewer.secretKey);
  } catch {
    throw new DisclosureError("the ciphertext does not open with this viewing key");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)) as unknown;
  } finally {
    plaintext.fill(0);
  }
}

export async function sealPayload(
  payload: DisclosurePayloadV1,
  viewerPublicKey: Uint8Array,
): Promise<Uint8Array> {
  return sealJson(validatePayload(payload), viewerPublicKey);
}

export async function openPayload(
  ciphertext: Uint8Array,
  viewer: { publicKey: Uint8Array; secretKey: Uint8Array },
): Promise<DisclosurePayloadV1> {
  return validatePayload(await openJson(ciphertext, viewer));
}
