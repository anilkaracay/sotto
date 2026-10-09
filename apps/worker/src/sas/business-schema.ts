// The Sotto credential and the sotto.business.v1 schema (08 section 5). Layout codes are the SAS
// schema data types (SAS program state/schema.rs; sas-lib 1.0.10 utils.js maps the same codes for
// the three used here): 0 u8, 8 i64, 12 String.
import { BUSINESS_LEVEL_AUTOMATIC, BUSINESS_LEVEL_REVIEW } from "@sotto/sdk/attestation";

export const SOTTO_CREDENTIAL_NAME = "sotto";
export const BUSINESS_SCHEMA_NAME = "sotto.business.v1";
/** The SAS program creates every schema at version 1 (create_schema.rs). */
export const BUSINESS_SCHEMA_VERSION = 1;
export const BUSINESS_SCHEMA_DESCRIPTION =
  "Sotto verified business: org id, legal name, country, verification time, level";

export const BUSINESS_SCHEMA_FIELDS = [
  { name: "org_id", layout: 12 },
  { name: "legal_name", layout: 12 },
  { name: "country", layout: 12 },
  { name: "verified_at", layout: 8 },
  { name: "level", layout: 0 },
] as const;

export const BUSINESS_SCHEMA_FIELD_NAMES: string[] = BUSINESS_SCHEMA_FIELDS.map((f) => f.name);
export const BUSINESS_SCHEMA_LAYOUT: number[] = BUSINESS_SCHEMA_FIELDS.map((f) => f.layout);

/**
 * Verification levels: 1 is manual review by a Sotto admin (D-09); 0 is the automatic verification
 * of a new organization on devnet, with no review (D-30). The values are `@sotto/sdk/attestation`'s.
 */
export const LEVEL_MANUAL_REVIEW = BUSINESS_LEVEL_REVIEW;
export const LEVEL_AUTOMATIC = BUSINESS_LEVEL_AUTOMATIC;

/** Attestations expire after 365 days (08 section 5). */
export const ATTESTATION_VALIDITY_SECONDS = 365 * 24 * 60 * 60;

export type BusinessAttestation = {
  org_id: string;
  legal_name: string;
  /** ISO 3166-1 alpha-2, as in orgs.country (08 section 2). */
  country: string;
  /** Unix seconds. */
  verified_at: bigint;
  level: number;
};

export function attestationExpiry(nowSeconds: bigint): bigint {
  return nowSeconds + BigInt(ATTESTATION_VALIDITY_SECONDS);
}
