// Single payment fields (F-06; step 1.9), shared by the payment page and its tests. The amount, memo
// and category never travel in plaintext: the page seals them to the owner's own viewing key (the
// payment's private blob, 07 section 2) and puts them in the sealed self and recipient disclosures
// after settlement (AC-06.4). The categories are the payload's outgoing ones (07 section 3).
import type { DisclosurePayloadV1 } from "@sotto/sdk/disclosure";

export const PAYMENT_CATEGORIES = ["supplier", "payroll", "payouts", "software", "other"] as const;
export type PaymentCategory = (typeof PAYMENT_CATEGORIES)[number] & DisclosurePayloadV1["category"];

export const CATEGORY_LABEL: Record<PaymentCategory, string> = {
  supplier: "Supplier",
  payroll: "Payroll",
  payouts: "Payout",
  software: "Software",
  other: "Other",
};

/** What a payment's private blob holds, sealed to the owner's viewing key. */
export type PaymentPrivate = {
  v: 1;
  /** Base units as a decimal string. */
  amount: string;
  memo: string | null;
  category: PaymentCategory;
};

export const MEMO_MAX = 200;
const CONTROL = /\p{Cc}/u;

/** Why this memo cannot be used, or null (at most 200 characters, no control characters). */
export function memoProblem(memo: string): string | null {
  if (memo.length > MEMO_MAX) return `Use at most ${MEMO_MAX} characters`;
  if (CONTROL.test(memo)) return "Remove the control characters";
  return null;
}

export function parsePaymentPrivate(value: unknown): PaymentPrivate | null {
  if (typeof value !== "object" || value === null) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(",") !== "amount,category,memo,v" || input.v !== 1) {
    return null;
  }
  if (typeof input.amount !== "string" || !/^[1-9][0-9]{0,19}$/.test(input.amount)) return null;
  if (input.memo !== null && (typeof input.memo !== "string" || memoProblem(input.memo))) {
    return null;
  }
  if (!PAYMENT_CATEGORIES.includes(input.category as PaymentCategory)) return null;
  return {
    v: 1,
    amount: input.amount,
    memo: input.memo as string | null,
    category: input.category as PaymentCategory,
  };
}

/** The words the payments table shows for each status. */
export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  authorized: "Authorized",
  executing: "Sending",
  settled: "Settled",
  failed_clean: "Did not complete",
  failed: "Failed",
};

/** A payment screening blocked (AC-06.2): shown as blocked, never offered again. */
export function isBlocked(errorCode: string | null): boolean {
  return errorCode === "screening_hit";
}

/** A payment the owner can send again: nothing of it landed, or it never started, and not blocked. */
export function canRetry(status: string, errorCode: string | null): boolean {
  if (isBlocked(errorCode)) return false;
  return status === "draft" || status === "authorized" || status === "failed_clean";
}
