// My pay in the tab (F-12, AC-12.1; step 2.6), for the pay page and its tests. No server only imports.
// A payslip is the recipient's own record of a payment to them, verified against the org owner's
// manifest (I-9) and opened with their viewing key in this tab: the net amount always, and the gross
// and the tax withheld when the payroll CSV gave them (`gross,tax`). The months and totals are sums
// of those records. Only a record of category payroll reads as a payslip; every other category reads
// as a payment received, without gross or tax (founder, 2026-09-30; 13 A49).
import { formatTokenAmount } from "@sotto/sdk/confidential/public";
import type { DisclosurePayloadV1 } from "@sotto/sdk/disclosure";
import { monthLabel } from "./books.ts";
import type { PayView } from "./server/pay.ts";

const DECIMALS = 6;

export type Payslip = {
  id: string;
  kind: "payment" | "payroll_line";
  /** When the payment settled, else when its record was written (ISO). */
  date: string;
  month: string;
  memo: string | null;
  category: DisclosurePayloadV1["category"];
  net: bigint;
  gross: bigint | null;
  tax: bigint | null;
  /** Holders of the org's grants who hold this payment's record. */
  readers: string[];
  signature: string | null;
};

/** One payslip per payment to the recipient that the server lists, from its record, newest first. */
export function payslipsOf(payloads: readonly DisclosurePayloadV1[], pay: PayView): Payslip[] {
  const slips = new Map<string, Payslip>();
  for (const payload of payloads) {
    if (payload.kind !== "payment" && payload.kind !== "payroll_line") continue;
    const payment = pay.payments.find((entry) => entry.id === payload.subject);
    if (!payment || slips.has(payment.id)) continue;
    const date = payment.settledAt ?? payload.created_at;
    slips.set(payment.id, {
      id: payment.id,
      kind: payload.kind,
      date,
      month: date.slice(0, 7),
      memo: payload.memo,
      category: payload.category,
      net: BigInt(payload.amount),
      gross: payload.gross === null ? null : BigInt(payload.gross),
      tax: payload.tax === null ? null : BigInt(payload.tax),
      readers: payment.readers,
      signature: payload.signatures[0] ?? null,
    });
  }
  return [...slips.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** The `count` calendar months ending with `now`'s, oldest first, YYYY-MM in UTC. */
export function lastMonths(now: Date, count = 6): string[] {
  const months: string[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    months.push(at.toISOString().slice(0, 7));
  }
  return months;
}

export function netByMonth(slips: readonly Payslip[], months: readonly string[]) {
  return months.map((month) => ({
    month,
    total: slips.filter((slip) => slip.month === month).reduce((sum, slip) => sum + slip.net, 0n),
  }));
}

/** A payroll record reads as a payslip; supplier, payouts, software and other as a payment. */
export function isPayslip(slip: Pick<Payslip, "category">): boolean {
  return slip.category === "payroll";
}

/** "September 2026" for a payroll line, the memo or "Payment" for anything else. */
export function payslipTitle(slip: Payslip): string {
  if (slip.kind === "payroll_line" && isPayslip(slip)) return monthLabel(slip.month, true);
  return slip.memo ?? "Payment";
}

/** Who can read a payslip: the recipient, the org, and each grant holder holding its record. */
export function readersWords(orgName: string, readers: readonly string[]): string {
  const names = [orgName, ...readers];
  const last = names.pop();
  return names.length === 0
    ? `You and ${last} can read this`
    : `You, ${names.join(", ")} and ${last} can read this`;
}

export const formatUsdc = (base: bigint) => `${formatTokenAmount(base, DECIMALS)} USDC`;

/**
 * The organizations whose pay the page groups: this page's first, then every other active one that
 * pays the recipient, by name.
 */
export function payOrgs(
  memberships: readonly { orgId: string; orgName: string; orgStatus: string; role: string }[],
  orgId: string,
): { orgId: string; orgName: string }[] {
  const paying = memberships.filter((m) => m.role === "recipient" && m.orgStatus === "active");
  const current = memberships.find((m) => m.orgId === orgId && m.role === "recipient");
  return [
    ...(current ? [{ orgId, orgName: current.orgName }] : []),
    ...paying
      .filter((m) => m.orgId !== orgId)
      .map((m) => ({ orgId: m.orgId, orgName: m.orgName }))
      .sort((a, b) => a.orgName.localeCompare(b.orgName)),
  ];
}
