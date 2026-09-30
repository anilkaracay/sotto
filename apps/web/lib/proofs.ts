// Proof of funds in words (F-13, step 2.8), for the owner's proofs page, the public verification page and
// their tests. No server only imports. The statement always says "at least" (X-22, D-06): "Balance is at
// least $X"; the result is Proven or Not proven (D-06, 13 L3), never True or False. A threshold is in
// base units of wUSDC (6 decimals), whose unit is one US dollar of USDC.
import { parseTokenAmount } from "@sotto/sdk/confidential/public";
import { formatDate } from "./format.ts";

export const USDC_DECIMALS = 6;
const USDC = 1_000_000n;

/** The builder's threshold chips (09 section 4), in base units. */
export const THRESHOLD_CHIPS = [
  { label: "$100k", base: 100_000n * USDC },
  { label: "$500k", base: 500_000n * USDC },
  { label: "$1M", base: 1_000_000n * USDC },
  { label: "$2.5M", base: 2_500_000n * USDC },
] as const;

/**
 * How long a record stays valid (05 section 3: chosen by the owner, at most 365 days after it is
 * written). The design has no control for it (13 A50); 30 days is the default.
 */
export const VALIDITY_OPTIONS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "180 days", days: 180 },
] as const;
export const DEFAULT_VALIDITY_DAYS = 30;

/** The longest counterparty label the page takes (the database refuses longer ones). */
export const LABEL_MAX = 120;

/**
 * "$100,000", "$7", "$1.50", "$0.000001": whole dollars with thousands separators, and every digit of
 * the fraction there is (at least two), so the words never round the record's threshold.
 */
export function usdWords(base: bigint): string {
  const whole = (base / USDC).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (base % USDC).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/, "");
  return fraction ? `$${whole}.${fraction.padEnd(2, "0")}` : `$${whole}`;
}

/** X-22: the statement a record proves. */
export function statementWords(threshold: bigint): string {
  return `Balance is at least ${usdWords(threshold)}`;
}

/** A custom threshold typed as dollars ("250000", "250,000", "7.5"); null when it is not an amount. */
export function parseThreshold(text: string): bigint | null {
  return parseTokenAmount(text.replaceAll(",", "").replace(/^\$/, ""), USDC_DECIMALS);
}

export const PROVEN = "Proven";
export const NOT_PROVEN = "Not proven";
/** 13 L3: the subline under Not proven. */
export const NOT_PROVEN_DETAIL = "This statement could not be proven. Nothing else was revealed.";
export const PROVEN_DETAIL = "The statement holds. The balance stays sealed.";

/** The expiry for `days` from `now`, in unix seconds (the program checks it against its clock). */
export function expiryFrom(now: Date, days: number): bigint {
  return BigInt(Math.floor(now.getTime() / 1000) + days * 24 * 60 * 60);
}

/** The public verification page of a record (AC-13.3). */
export function verifyPath(recordAddress: string): string {
  return `/v/${recordAddress}`;
}

/** The state of an issued record as the chain shows it now. */
export type RecordState = "valid" | "expired" | "closed";

export function recordState(
  input: { exists: boolean; expiry: Date | string },
  now: Date,
): RecordState {
  if (!input.exists) return "closed";
  return new Date(input.expiry).getTime() <= now.getTime() ? "expired" : "valid";
}

export const RECORD_STATE_WORDS: Record<RecordState, string> = {
  valid: "Valid",
  expired: "Expired",
  closed: "Closed",
};

/** "Valid until 29 Oct 2026" or "Expired on 29 Oct 2026". */
export function expiryWords(expiry: Date | string, now: Date): string {
  const date = formatDate(expiry);
  return new Date(expiry).getTime() <= now.getTime() ? `Expired on ${date}` : `Valid until ${date}`;
}

/** Plain words for the program's errors (05 section 5, codes 0 to 16), for the owner's page. */
const PROOF_ERRORS: readonly string[] = [
  "Verification is paused: the proof program is not writing new records right now.",
  "The threshold must be above zero.",
  "The validity period is not accepted: it must end after now and within 365 days.",
  "Your wUSDC account is not a Token-2022 account.",
  "The account is not a wUSDC account of this network.",
  "The wUSDC account belongs to another wallet.",
  "Your wUSDC account has no confidential balance yet.",
  "Your wUSDC account's confidential balance is not approved.",
  "A proof account was not written by the ZK ElGamal Proof program.",
  "A proof account holds another kind of proof.",
  "A proof account belongs to another wallet.",
  "The proof was made for another encryption key than your account's.",
  "Your balance changed after the proof was made, so it no longer matches.",
  "The range proof does not prove one 64 bit amount.",
  "The range proof is for another commitment than the equality proof.",
  "Your wallet may not do this.",
  "The record has not expired yet, so it cannot be closed.",
];

export function proofErrorWords(code: number): string {
  return PROOF_ERRORS[code] ?? `The proof program refused the transaction with error ${code}.`;
}
