// Viewing grant words (F-10; step 2.4), shared by the viewing keys page, the invite page and their tests.
// No server only imports. The scopes are the hackathon ones (D-27): every amount, every amount in a
// period, payroll only, and a recipient's own payslips; the expiry choices include No expiry.
import { formatDate } from "./format.ts";

export type GrantScopeName = "all_payments" | "period" | "payroll_only" | "own_payslips";

export const GRANT_SCOPE_CHOICES = [
  { scope: "all_payments", label: "Every amount" },
  { scope: "period", label: "One period" },
  { scope: "payroll_only", label: "Payroll only" },
] as const;

export const GRANT_EXPIRY_CHOICES = [
  { expiry: "30_days", label: "30 days" },
  { expiry: "end_of_quarter", label: "End of quarter" },
  { expiry: "end_of_year", label: "End of year" },
  { expiry: "none", label: "No expiry" },
] as const;

export type GrantExpiryChoiceName = (typeof GRANT_EXPIRY_CHOICES)[number]["expiry"];

/** What a grant reads, in words: "Every amount", "Every amount, 1 Jul 2026 to 30 Sep 2026". */
export function scopeWords(
  scope: GrantScopeName,
  periodFrom: string | null,
  periodTo: string | null,
): string {
  switch (scope) {
    case "all_payments":
      return "Every amount";
    case "period":
      return periodFrom && periodTo
        ? `Every amount, ${formatDate(`${periodFrom}T00:00:00Z`)} to ${formatDate(`${periodTo}T00:00:00Z`)}`
        : "Every amount in one period";
    case "payroll_only":
      return "Payroll only";
    case "own_payslips":
      return "Own payslips";
  }
}

/**
 * When a grant ends, as the last day it is open: an expiry at a day's first instant (the end of a
 * quarter or year) shows the day before; "No expiry" without one.
 */
export function expiryWords(expiresAt: string | null): string {
  if (!expiresAt) return "No expiry";
  const at = new Date(expiresAt);
  const midnight = at.getUTCHours() === 0 && at.getUTCMinutes() === 0 && at.getUTCSeconds() === 0;
  return `Until ${formatDate(midnight ? new Date(at.getTime() - 1) : at)}`;
}

/** The expiry a choice gives from now, in UTC, as the server computes it (for the drawer's preview). */
export function previewExpiry(choice: GrantExpiryChoiceName, now = new Date()): string | null {
  const year = now.getUTCFullYear();
  switch (choice) {
    case "30_days":
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    case "end_of_quarter":
      return new Date(Date.UTC(year, Math.floor(now.getUTCMonth() / 3) * 3 + 3, 1)).toISOString();
    case "end_of_year":
      return new Date(Date.UTC(year + 1, 0, 1)).toISOString();
    case "none":
      return null;
  }
}

/** The current calendar quarter's first and last day in UTC, YYYY-MM-DD (the period's default). */
export function currentQuarter(now = new Date()): { from: string; to: string } {
  const start = Math.floor(now.getUTCMonth() / 3) * 3;
  const from = new Date(Date.UTC(now.getUTCFullYear(), start, 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), start + 3, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export type GrantStatusName = "pending_viewer_key" | "active" | "revoked" | "expired";

/** The chip of a grant's status, with its invite's state while it waits for its holder. */
export function grantStatusChip(
  status: GrantStatusName,
  invite: { status: "pending" | "accepted" | "expired" } | null,
): { label: string; tone: "green" | "amber" | "neutral" | "red" } {
  switch (status) {
    case "active":
      return { label: "Active", tone: "green" };
    case "revoked":
      return { label: "Revoked", tone: "neutral" };
    case "expired":
      return { label: "Expired", tone: "neutral" };
    case "pending_viewer_key":
      if (invite?.status === "pending") return { label: "Invite sent", tone: "amber" };
      if (invite?.status === "expired") return { label: "Invite expired", tone: "red" };
      return { label: "Waiting for viewing key", tone: "amber" };
  }
}

/** "Today", "Yesterday", "3 days ago", or the date; "Not yet" when never. */
export function lastUsedWords(lastUsedAt: string | null, now = new Date()): string {
  if (!lastUsedAt) return "Not yet";
  const days = Math.floor(
    (Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      new Date(lastUsedAt.slice(0, 10)).getTime()) /
      (24 * 60 * 60 * 1000),
  );
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return formatDate(lastUsedAt);
}

/** AC-10.4 and 07 section 7, exactly. */
export const REVOKE_COPY =
  "Revoking stops access from now on. It cannot erase what was already viewed.";
