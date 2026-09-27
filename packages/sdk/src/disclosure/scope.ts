// Which item kinds a grant scope receives (07 section 6). The server refuses to store an item for a
// grant whose scope does not cover its kind. The rest of the scope evaluation (the period's dates, the
// lines that are the viewer's own) needs payments and comes with them (steps 1.9 and Phase 2 grants).
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
