// Which items a grant scope receives (07 section 6). The server refuses to store an item for a grant
// that does not cover it, and since step 2.4 the owner's browser uses the same rule to choose the
// grants a new payment or payroll line is disclosed to, and the server to list what a back fill must
// share: the kind, and for a period grant the time the payment settled.
import type { DisclosureKind } from "./payload.ts";

export type GrantScope = "all_payments" | "period" | "payroll_only" | "own_payslips";

const KINDS: Record<GrantScope, readonly DisclosureKind[]> = {
  all_payments: ["payment", "payroll_line", "balance_snapshot"],
  period: ["payment", "payroll_line", "balance_snapshot"],
  payroll_only: ["payroll_line"],
  own_payslips: ["payroll_line"],
};

export function scopeAllowsKind(scope: GrantScope, kind: DisclosureKind): boolean {
  return KINDS[scope].includes(kind);
}

export type GrantCoverage = {
  scope: GrantScope;
  /** A period grant's first and last day, YYYY-MM-DD in UTC, both included; null otherwise. */
  periodFrom: string | null;
  periodTo: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A period's bounds as times: from its first day at 00:00 UTC included to the day after its last. */
export function periodBounds(periodFrom: string, periodTo: string): { from: Date; to: Date } {
  if (!DATE.test(periodFrom) || !DATE.test(periodTo)) {
    throw new Error("a period is two YYYY-MM-DD dates");
  }
  const from = new Date(`${periodFrom}T00:00:00.000Z`);
  const to = new Date(new Date(`${periodTo}T00:00:00.000Z`).getTime() + DAY_MS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
    throw new Error("a period ends on or after the day it starts");
  }
  return { from, to };
}

/**
 * Whether a grant covers an item (07 section 6, 07 section 9's table): its kind, for a period grant
 * the time the item's payment settled (from inclusive, to exclusive, UTC), and for own payslips only
 * the viewer's own lines (`ownLine`, which the caller knows).
 */
export function scopeCovers(
  grant: GrantCoverage,
  item: { kind: DisclosureKind; settledAt: Date | null; ownLine?: boolean },
): boolean {
  if (!scopeAllowsKind(grant.scope, item.kind)) return false;
  if (grant.scope === "own_payslips") return item.ownLine === true;
  if (grant.scope !== "period") return true;
  if (!grant.periodFrom || !grant.periodTo || !item.settledAt) return false;
  const { from, to } = periodBounds(grant.periodFrom, grant.periodTo);
  return item.settledAt >= from && item.settledAt < to;
}
