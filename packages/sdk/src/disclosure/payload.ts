// The disclosure payload, version 1 (07 section 3), and its validation. A payload is sealed to one
// viewer; no plaintext hash of it is ever stored (a small amount is brute forceable from a hash).
export const DISCLOSURE_KINDS = [
  "payment",
  "payroll_line",
  "month_total",
  "balance_snapshot",
] as const;
export const DISCLOSURE_CATEGORIES = [
  "payroll",
  "supplier",
  "revenue",
  "payouts",
  "software",
  "other",
] as const;

export type DisclosureKind = (typeof DISCLOSURE_KINDS)[number];

export type DisclosurePayloadV1 = {
  v: 1;
  org: string;
  kind: DisclosureKind;
  direction: "in" | "out";
  category: (typeof DISCLOSURE_CATEGORIES)[number];
  /** A payment or line id, YYYY-MM for totals, or an ISO date for snapshots. */
  subject: string;
  /** Base units as a decimal string. */
  amount: string;
  currency: "USDC";
  memo: string | null;
  gross: string | null;
  tax: string | null;
  counterparty: string | null;
  signatures: string[];
  created_at: string;
  /**
   * Step 2.12: a `balance_snapshot` holds the decrypted available balance in `amount` and the pending
   * balance here, base units as a decimal string; no other kind has this field.
   */
  pending?: string;
};

export class DisclosureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DisclosureError";
  }
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BASE_UNITS = /^(0|[1-9][0-9]{0,19})$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const FIELDS = [
  "v",
  "org",
  "kind",
  "direction",
  "category",
  "subject",
  "amount",
  "currency",
  "memo",
  "gross",
  "tax",
  "counterparty",
  "signatures",
  "created_at",
];

function text(value: unknown, field: string, max: number, nullable: boolean): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new DisclosureError(`${field} must be a string of 1 to ${max} characters`);
  }
  return value;
}

function units(value: unknown, field: string, nullable: boolean): string | null {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || !BASE_UNITS.test(value)) {
    throw new DisclosureError(`${field} must be base units as a decimal string`);
  }
  return value;
}

/** The ISO date a balance snapshot names as its subject (07 section 3). */
const ISO_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * A version 1 payload, exactly: every field present, nothing else. A `balance_snapshot` (step 2.12)
 * also carries `pending`, names its ISO date as the subject and has no flow fields: direction `in`,
 * category `other`, no memo, gross, tax, counterparty or signature.
 */
export function validatePayload(value: unknown): DisclosurePayloadV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DisclosureError("the payload must be an object");
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  const snapshot = input.kind === "balance_snapshot";
  const fields = snapshot ? [...FIELDS, "pending"] : FIELDS;
  const unknown = keys.filter((key) => !fields.includes(key));
  const missing = fields.filter((key) => !(key in input));
  if (unknown.length > 0) throw new DisclosureError(`unknown fields: ${unknown.join(", ")}`);
  if (missing.length > 0) throw new DisclosureError(`missing fields: ${missing.join(", ")}`);
  if (input.v !== 1) throw new DisclosureError("v must be 1");
  if (typeof input.org !== "string" || !UUID.test(input.org)) {
    throw new DisclosureError("org must be a uuid");
  }
  if (!DISCLOSURE_KINDS.includes(input.kind as DisclosureKind)) {
    throw new DisclosureError("kind is not a disclosure kind");
  }
  if (input.direction !== "in" && input.direction !== "out") {
    throw new DisclosureError("direction must be in or out");
  }
  if (!DISCLOSURE_CATEGORIES.includes(input.category as DisclosurePayloadV1["category"])) {
    throw new DisclosureError("category is not a disclosure category");
  }
  if (input.currency !== "USDC") throw new DisclosureError("currency must be USDC");
  if (
    !Array.isArray(input.signatures) ||
    input.signatures.length > 64 ||
    !input.signatures.every((item) => typeof item === "string" && SIGNATURE.test(item))
  ) {
    throw new DisclosureError("signatures must be at most 64 transaction signatures");
  }
  if (typeof input.created_at !== "string" || !ISO_UTC.test(input.created_at)) {
    throw new DisclosureError("created_at must be an ISO 8601 UTC time");
  }
  if (snapshot) {
    if (typeof input.subject !== "string" || !ISO_DATE.test(input.subject)) {
      throw new DisclosureError("a balance snapshot's subject is its ISO date");
    }
    if (
      input.direction !== "in" ||
      input.category !== "other" ||
      input.memo !== null ||
      input.gross !== null ||
      input.tax !== null ||
      input.counterparty !== null ||
      (input.signatures as unknown[]).length !== 0
    ) {
      throw new DisclosureError("a balance snapshot has no flow fields");
    }
  }
  const pending = snapshot ? { pending: units(input.pending, "pending", false) as string } : {};
  return {
    v: 1,
    org: input.org,
    kind: input.kind as DisclosureKind,
    direction: input.direction,
    category: input.category as DisclosurePayloadV1["category"],
    subject: text(input.subject, "subject", 100, false) as string,
    amount: units(input.amount, "amount", false) as string,
    currency: "USDC",
    memo: text(input.memo, "memo", 500, true),
    gross: units(input.gross, "gross", true),
    tax: units(input.tax, "tax", true),
    counterparty: text(input.counterparty, "counterparty", 200, true),
    signatures: [...(input.signatures as string[])],
    created_at: input.created_at,
    ...pending,
  };
}
