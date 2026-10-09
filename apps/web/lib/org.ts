// Organization fields and status (F-02, 08 sections 2 and 3), shared by the API and the onboarding
// form so both validate the same way. No server only imports.
import { ASSET_IDS, type AssetId } from "@sotto/sdk/cluster/assets";
import { z } from "zod";
import { isCountryCode } from "./countries.ts";

export type OrgStatus = "pending_review" | "active" | "suspended";

/** The legal name is attestation data (08 section 5); the byte cap keeps its transaction small. */
export const LEGAL_NAME_MAX_BYTES = 400;

const CONTROL = /\p{Cc}/u;

function text(required: string, max: number) {
  return z
    .string(required)
    .trim()
    .min(1, required)
    .max(max, `Use at most ${max} characters`)
    .refine((value) => !CONTROL.test(value), "Remove the control characters");
}

export const orgFieldsSchema = z
  .object({
    displayName: text("Enter the name to show in Sotto", 80),
    legalName: text("Enter the legal name as registered", 200).refine(
      (value) => new TextEncoder().encode(value).length <= LEGAL_NAME_MAX_BYTES,
      "Use a shorter legal name",
    ),
    country: z.string("Choose a country").refine(isCountryCode, "Choose a country"),
    registrationNo: text("Enter the company registration number", 64),
    website: z
      .url({
        protocol: /^https?$/,
        hostname: z.regexes.domain,
        error: "Enter the website address, for example https://example.com",
      })
      .max(200, "Use at most 200 characters"),
    contactEmail: z.email("Enter a valid email address").max(254, "Use at most 254 characters"),
  })
  .strict();

/**
 * POST /api/orgs: the display name is optional and defaults to the legal name. The asset (step 4.3,
 * D-29) is chosen here once, USDC when not given; the server takes only an asset of its network's
 * registry, and no request changes it later (orgUpdateSchema has no asset).
 */
export const orgCreateSchema = orgFieldsSchema
  .extend({ asset: z.enum(ASSET_IDS as [AssetId, ...AssetId[]], "Choose a currency").optional() })
  .partial({ displayName: true });

/**
 * PATCH /api/orgs/:id: any subset, at least one field. Step 4.6 (D-33): a detail that may be absent
 * (the country, the registration number, the website, the contact email) is cleared with null.
 */
export const orgUpdateSchema = orgFieldsSchema
  .extend({
    country: orgFieldsSchema.shape.country.nullable(),
    registrationNo: orgFieldsSchema.shape.registrationNo.nullable(),
    website: orgFieldsSchema.shape.website.nullable(),
    contactEmail: orgFieldsSchema.shape.contactEmail.nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Send at least one field to change");

export type OrgCreate = z.infer<typeof orgCreateSchema>;
export type OrgUpdate = z.infer<typeof orgUpdateSchema>;

/** How an organization was verified: a Sotto admin's review (D-09), or automatically on devnet (D-30). */
export type OrgVerification = "review" | "automatic";

/**
 * D-30: on the devnet configuration a new organization is verified the moment it is created, with
 * no review, so anyone can try Sotto with test money. Every other configuration keeps the admin's
 * review of D-09.
 */
export function verificationOnCreate(cluster: string | null): OrgVerification {
  return cluster === "devnet" ? "automatic" : "review";
}

/**
 * D-33: the company devnet's quick start makes for a wallet that signs in for the first time. It has
 * a name and nothing else until its owner fills in the rest.
 */
export const QUICK_START_NAME = "My company";

/** Reviewed by the admin, so fixed once the review is done (08 section 3). */
export const REVIEWED_FIELDS = ["legalName", "country", "registrationNo", "website"] as const;

/** Money features (F-03 to F-09) are available to active orgs only (AC-02.2, AC-02.4). */
export function moneyEnabled(status: OrgStatus): boolean {
  return status === "active";
}

/** Status words in the app: suspended covers rejected and revoked verification alike. */
export function orgStatusLabel(status: OrgStatus): string {
  if (status === "active") return "Verified";
  if (status === "suspended") return "Not verified";
  return "In review";
}

/** The form accepts a bare domain and adds https:// (the API itself requires the scheme). */
export function normalizeWebsite(input: string): string {
  const value = input.trim();
  if (value === "" || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value;
  return `https://${value}`;
}

/** What the attestation onchain carries of an organization (08 section 5): a change means a new one. */
export const ATTESTED_FIELDS = ["legalName", "country"] as const;
