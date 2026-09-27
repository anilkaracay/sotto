// Keys (06 sections 1 and 2, 07 section 5). The derivation functions return secret key material:
// call them only inside the crypto Web Worker (10 section 3).
export {
  assertElGamalKeyMatches,
  deriveStandardKeys,
  elgamalKeyMatches,
  KeyDerivationError,
  KeyMismatchError,
  zeroConfidentialKeys,
  type ConfidentialKeyMaterial,
} from "./confidential.ts";
export {
  bytesEqual,
  CONFIDENTIAL_KEYS_MESSAGE_TEXT,
  confidentialKeysMessage,
  viewKeyMessage,
} from "./messages.ts";
export { verifyViewKeyRegistration, viewKeyRegistrationMessage } from "./registration.ts";
export {
  checkSignedMessage,
  verifyWalletSignature,
  type SignedMessageCheck,
} from "./signatures.ts";
export { deriveViewingKey, zeroViewingKey, type ViewingKeyMaterial } from "./viewing.ts";
