// Viewer key registration (07 section 5, I-8), without the key derivation dependencies, so servers can
// verify registrations with `@solana/kit` alone (exported through `@sotto/sdk/keys/public`).
import { getBase64Decoder } from "@solana/kit";
import { verifyWalletSignature } from "./signatures.ts";

const encoder = new TextEncoder();

/** 07 section 5: `sotto-view-key-register/v1` newline the base64 X25519 public key. */
export function viewKeyRegistrationMessage(publicKey: Uint8Array): Uint8Array {
  return encoder.encode(`sotto-view-key-register/v1\n${getBase64Decoder().decode(publicKey)}`);
}

/**
 * I-8: a viewer public key is used only if the viewer's wallet signed its registration message. This
 * stops a server from substituting a key it controls (07 section 5).
 */
export async function verifyViewKeyRegistration(input: {
  wallet: string;
  publicKey: Uint8Array;
  signature: Uint8Array;
}): Promise<boolean> {
  if (input.publicKey.length !== 32) return false;
  return verifyWalletSignature(
    input.wallet,
    viewKeyRegistrationMessage(input.publicKey),
    input.signature,
  );
}
