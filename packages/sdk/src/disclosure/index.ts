// The disclosure engine (07 sections 2 to 5): canonical JSON, the version 1 payload and signed
// manifests. No libsodium: servers and pages import this; sealing and opening are in
// `@sotto/sdk/disclosure/seal`, which the crypto worker loads.
export { canonicalJson, canonicalJsonBytes, CanonicalJsonError } from "./canonical.ts";
export {
  buildManifest,
  itemInManifest,
  MANIFEST_PREFIX,
  manifestMessage,
  MAX_MANIFEST_ITEMS,
  sha256Hex,
  validateManifest,
  verifyManifest,
  type ManifestCheck,
  type ManifestItem,
  type ManifestV1,
} from "./manifest.ts";
export {
  DISCLOSURE_CATEGORIES,
  DISCLOSURE_KINDS,
  DisclosureError,
  validatePayload,
  type DisclosureKind,
  type DisclosurePayloadV1,
} from "./payload.ts";
export { scopeAllowsKind, type GrantScope } from "./scope.ts";
