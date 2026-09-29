// Viewing grant words and choices (F-10; step 2.4): the scopes of the hackathon build (no totals_only,
// D-27), the expiry choices with No expiry (X-52) computed in the browser exactly as the server does,
// the last day a grant is open, the status chips and the revoke copy of AC-10.4.
import { describe, expect, it } from "vitest";
import {
  currentQuarter,
  expiryWords,
  GRANT_EXPIRY_CHOICES,
  GRANT_SCOPE_CHOICES,
  grantStatusChip,
  lastUsedWords,
  previewExpiry,
  REVOKE_COPY,
  scopeWords,
} from "../lib/grant.ts";
import { expiryFor } from "../lib/server/grants.ts";

describe("grant words (F-10)", () => {
  it("AC-10.1 offers every amount, one period and payroll only, and the expiries with No expiry", () => {
    expect(GRANT_SCOPE_CHOICES.map((choice) => choice.label)).toEqual([
      "Every amount",
      "One period",
      "Payroll only",
    ]);
    expect(GRANT_EXPIRY_CHOICES.map((choice) => choice.label)).toEqual([
      "30 days",
      "End of quarter",
      "End of year",
      "No expiry",
    ]);
    expect(scopeWords("all_payments", null, null)).toBe("Every amount");
    expect(scopeWords("period", "2026-07-01", "2026-09-30")).toBe(
      "Every amount, 1 Jul 2026 to 30 Sep 2026",
    );
    expect(scopeWords("payroll_only", null, null)).toBe("Payroll only");
    expect(scopeWords("own_payslips", null, null)).toBe("Own payslips");
  });

  it("AC-10.1 previews each expiry as the server computes it, and shows the last open day", () => {
    for (const now of [
      new Date("2026-09-29T10:00:00Z"),
      new Date("2026-12-31T23:59:00Z"),
      new Date("2027-02-01T00:00:00Z"),
    ]) {
      for (const { expiry } of GRANT_EXPIRY_CHOICES) {
        expect(previewExpiry(expiry, now)).toBe(expiryFor(expiry, now)?.toISOString() ?? null);
      }
    }
    expect(expiryWords(null)).toBe("No expiry");
    expect(expiryWords("2027-01-01T00:00:00.000Z")).toBe("Until 31 Dec 2026");
    expect(expiryWords("2026-10-29T10:00:00.000Z")).toBe("Until 29 Oct 2026");
    expect(currentQuarter(new Date("2026-09-29T10:00:00Z"))).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
    });
  });

  it("AC-10.4 names each status, the last use, and says that what was viewed cannot be unseen", () => {
    expect(grantStatusChip("pending_viewer_key", { status: "pending" }).label).toBe("Invite sent");
    expect(grantStatusChip("pending_viewer_key", { status: "accepted" }).label).toBe(
      "Waiting for viewing key",
    );
    expect(grantStatusChip("active", null)).toEqual({ label: "Active", tone: "green" });
    expect(grantStatusChip("revoked", null).label).toBe("Revoked");
    const now = new Date("2026-09-29T12:00:00Z");
    expect(lastUsedWords(null, now)).toBe("Not yet");
    expect(lastUsedWords("2026-09-29T08:00:00Z", now)).toBe("Today");
    expect(lastUsedWords("2026-09-28T23:00:00Z", now)).toBe("Yesterday");
    expect(lastUsedWords("2026-09-24T08:00:00Z", now)).toBe("5 days ago");
    expect(REVOKE_COPY).toBe(
      "Revoking stops access from now on. It cannot erase what was already viewed.",
    );
  });
});
