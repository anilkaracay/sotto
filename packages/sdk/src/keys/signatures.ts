// Wallet signatures over key messages. A signature is used only if it is a valid Ed25519 signature by
// the wallet over exactly the requested bytes: a wallet that signs something else (for example with
// a prefix) would derive keys that no standard client derives.
import {
  address,
  getPublicKeyFromAddress,
  isAddress,
  signatureBytes,
  verifySignature,
} from "@solana/kit";
import { bytesEqual } from "./messages.ts";

export async function verifyWalletSignature(
  wallet: string,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  if (!isAddress(wallet) || signature.length !== 64) return false;
  const publicKey = await getPublicKeyFromAddress(address(wallet));
  return verifySignature(publicKey, signatureBytes(new Uint8Array(signature)), message);
}

export type SignedMessageCheck =
  { ok: true } | { ok: false; reason: "message_changed" | "bad_signature" };

/** Checks a Wallet Standard `solana:signMessage` output against the message the app asked for. */
export async function checkSignedMessage(input: {
  wallet: string;
  requested: Uint8Array;
  signedMessage: Uint8Array;
  signature: Uint8Array;
}): Promise<SignedMessageCheck> {
  if (!bytesEqual(input.signedMessage, input.requested)) {
    return { ok: false, reason: "message_changed" };
  }
  if (!(await verifyWalletSignature(input.wallet, input.requested, input.signature))) {
    return { ok: false, reason: "bad_signature" };
  }
  return { ok: true };
}
