// Viewing keys (06 section 2, 07 sections 2 and 5): an X25519 keypair derived from the wallet's
// signature of `sotto-view-key/v1\n<wallet>`.
import type { Address } from "@solana/kit";
import sodium from "libsodium-wrappers-sumo";
import { KeyDerivationError } from "./confidential.ts";
import { viewKeyMessage } from "./messages.ts";
import { verifyWalletSignature } from "./signatures.ts";

export type ViewingKeyMaterial = { publicKey: Uint8Array; secretKey: Uint8Array };

const encoder = new TextEncoder();

/** seed = HKDF-SHA256(ikm = signature, salt = "sotto", info = "x25519", 32 bytes). */
async function viewingSeed(signature: Uint8Array): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey("raw", new Uint8Array(signature), "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("sotto"),
      info: encoder.encode("x25519"),
    },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

/** keypair = libsodium `crypto_box_seed_keypair(seed)`; the signature must verify against the wallet. */
export async function deriveViewingKey(
  wallet: Address,
  signature: Uint8Array,
): Promise<ViewingKeyMaterial> {
  if (!(await verifyWalletSignature(wallet, viewKeyMessage(wallet), signature))) {
    throw new KeyDerivationError(
      "bad_signature",
      "The signature is not the wallet's signature of the viewing key message",
    );
  }
  const seed = await viewingSeed(signature);
  await sodium.ready;
  const pair = sodium.crypto_box_seed_keypair(seed);
  seed.fill(0);
  return { publicKey: pair.publicKey, secretKey: pair.privateKey };
}

/**
 * Step 4.6 (D-32): the viewing keypair of a published secret key, for the demo company's read only
 * roles. The public key follows from the secret key (X25519 base point multiplication), so a caller
 * cannot pair a secret key with another public key. A viewing key opens sealed records and nothing
 * else: it is no Ed25519 key, so it signs no message and no transaction.
 */
export async function viewingKeyFromSecret(secretKey: Uint8Array): Promise<ViewingKeyMaterial> {
  if (secretKey.length !== 32) {
    throw new KeyDerivationError("bad_signature", "A viewing secret key is 32 bytes");
  }
  await sodium.ready;
  const copy = new Uint8Array(secretKey);
  return { publicKey: sodium.crypto_scalarmult_base(copy), secretKey: copy };
}

export function zeroViewingKey(keys: ViewingKeyMaterial): void {
  keys.secretKey.fill(0);
}
