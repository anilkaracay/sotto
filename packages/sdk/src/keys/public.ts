// The part of the keys module that holds no key material and needs neither the zk-sdk WASM nor
// libsodium: the messages, the wallet signature checks and the viewer key registration check (I-8).
// Pages and servers import `@sotto/sdk/keys/public`; the derivation (`@sotto/sdk/keys`) is loaded only
// by the crypto Web Worker (10 section 3).
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
