// Confidential keys (06 section 1, D-03 `standard_v1`): the standard `deriveConfidentialKeys` of
// `@solana-program/token-2022/confidential`, fed with the signature the wallet produced on the main
// thread, so the keys can be derived inside the crypto Web Worker (04 section 5, 10 section 3). The
// spl-token CLI derives the same ElGamal key for the same keypair (verified in step 1.5).
import { deriveConfidentialKeys } from "@solana-program/token-2022/confidential";
import type { Address, MessagePartialSigner, SignatureBytes } from "@solana/kit";
import { bytesEqual, confidentialKeysMessage } from "./messages.ts";
import { verifyWalletSignature } from "./signatures.ts";

export type ConfidentialKeyMaterial = {
  /** The ElGamal public key as an address (32 bytes, base58), as token accounts store it. */
  elgamalPubkey: Address;
  elgamalSecretKey: Uint8Array;
  aeKey: Uint8Array;
};

export class KeyDerivationError extends Error {
  readonly reason: "bad_signature" | "unexpected_message";
  constructor(reason: "bad_signature" | "unexpected_message", message: string) {
    super(message);
    this.name = "KeyDerivationError";
    this.reason = reason;
  }
}

/**
 * Derives the `standard_v1` keys from the wallet's signature of `solana-conf-bal/v1`. The signature
 * must verify against the wallet first. The derivation asks its signer for exactly one signature; the
 * replay signer below answers only for the expected message bytes.
 */
export async function deriveStandardKeys(
  wallet: Address,
  signature: Uint8Array,
): Promise<ConfidentialKeyMaterial> {
  const message = confidentialKeysMessage();
  if (!(await verifyWalletSignature(wallet, message, signature))) {
    throw new KeyDerivationError(
      "bad_signature",
      "The signature is not the wallet's signature of the key message",
    );
  }
  const signer: MessagePartialSigner = {
    address: wallet,
    signMessages: async (messages) =>
      messages.map((signable) => {
        if (!bytesEqual(new Uint8Array(signable.content), message)) {
          throw new KeyDerivationError(
            "unexpected_message",
            "The key derivation asked to sign a message other than solana-conf-bal/v1",
          );
        }
        return { [wallet]: new Uint8Array(signature) as SignatureBytes };
      }),
  };
  const keys = await deriveConfidentialKeys({ signer });
  return {
    elgamalPubkey: keys.elgamalKeypair.elgamalPubkey,
    elgamalSecretKey: keys.elgamalKeypair.secretKey,
    aeKey: keys.aeKey,
  };
}

export function zeroConfidentialKeys(keys: ConfidentialKeyMaterial): void {
  keys.elgamalSecretKey.fill(0);
  keys.aeKey.fill(0);
}

export class KeyMismatchError extends Error {
  constructor() {
    super(
      "The keys this wallet derives do not match the ElGamal key of the token account: wrong wallet or wrong key scheme",
    );
    this.name = "KeyMismatchError";
  }
}

/** I-5: derived keys are used for an account only if they match its onchain ElGamal key. */
export function elgamalKeyMatches(derived: Address, onchain: Address): boolean {
  return derived === onchain;
}

export function assertElGamalKeyMatches(derived: Address, onchain: Address): void {
  if (!elgamalKeyMatches(derived, onchain)) throw new KeyMismatchError();
}
