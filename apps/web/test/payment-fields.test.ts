// Single payment fields and wording (F-06; step 1.9), shared by the payment page: the private blob's
// shape, the memo rule, which payments can be tried again, and the status words.
import { describe, expect, it } from "vitest";
import {
  canRetry,
  isBlocked,
  memoProblem,
  parsePaymentPrivate,
  PAYMENT_STATUS_LABEL,
} from "../lib/payment.ts";

describe("payment fields", () => {
  it("reads only a well formed private blob", () => {
    const good = { v: 1, amount: "12345678", memo: "Invoice 42", category: "supplier" };
    expect(parsePaymentPrivate(good)).toEqual(good);
    expect(parsePaymentPrivate({ ...good, memo: null })).not.toBeNull();
    for (const bad of [
      null,
      { ...good, v: 2 },
      { ...good, amount: "0" },
      { ...good, amount: "1.5" },
      { ...good, category: "revenue" },
      { ...good, memo: "x".repeat(201) },
      { ...good, extra: 1 },
    ]) {
      expect(parsePaymentPrivate(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(memoProblem("x".repeat(201))).toBe("Use at most 200 characters");
    expect(memoProblem("tab\there")).toBe("Remove the control characters");
    expect(memoProblem("Invoice 42")).toBeNull();
  });

  it("AC-06.5 offers a retry only for payments of which nothing landed, and never after a screening hit", () => {
    for (const status of ["draft", "authorized", "failed_clean"]) {
      expect(canRetry(status, null)).toBe(true);
    }
    for (const status of ["executing", "settled", "failed"]) {
      expect(canRetry(status, null)).toBe(false);
    }
    expect(isBlocked("screening_hit")).toBe(true);
    expect(canRetry("draft", "screening_hit")).toBe(false);
    expect(PAYMENT_STATUS_LABEL).toMatchObject({
      settled: "Settled",
      failed_clean: "Did not complete",
      executing: "Sending",
    });
  });
});
