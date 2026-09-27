// The messages a wallet signs for keys: the confidential keys (D-03 standard_v1, 06 section 1) and the
// viewing key (06 section 2). The registration message is in registration.ts.
const encoder = new TextEncoder();

/**
 * D-03 `standard_v1`: the constant message of the standard derivation, `ConfidentialKeys.signerMessage()`
 * of `@solana/zk-sdk` (facts A11). It names neither Sotto nor the wallet (10 section 2).
 */
export const CONFIDENTIAL_KEYS_MESSAGE_TEXT = "solana-conf-bal/v1";

export function confidentialKeysMessage(): Uint8Array {
  return encoder.encode(CONFIDENTIAL_KEYS_MESSAGE_TEXT);
}

/** 06 section 2: `sotto-view-key/v1` newline the wallet address. */
export function viewKeyMessage(wallet: string): Uint8Array {
  return encoder.encode(`sotto-view-key/v1\n${wallet}`);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
