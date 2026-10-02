// The accountant's books in the tab (F-11, AC-11.2, AC-11.4; step 2.5), for the Books page and its
// tests. No server only imports. The ledger is built only from the accountant's own records, each
// verified against the owner's manifest (I-9) and opened with their viewing key in this tab, joined
// with the metadata the server gives for exactly those payments (lib/server/books.ts). Every figure is
// a sum of those records: money out only (money in is Post-hackathon, M1). The CSV is generated here,
// from the rows the ledger shows, and never leaves the tab.
import { formatTokenAmount } from "@sotto/sdk/confidential/public";
import type { DisclosurePayloadV1 } from "@sotto/sdk/disclosure";
import type { BooksPaymentView } from "./server/books.ts";

const DECIMALS = 6;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const BOOKS_CATEGORY_LABEL: Record<DisclosurePayloadV1["category"], string> = {
  payroll: "Payroll",
  supplier: "Supplier",
  revenue: "Revenue",
  payouts: "Payouts",
  software: "Software",
  other: "Other",
};

export type LedgerRow = {
  id: string;
  kind: "payment" | "payroll_line";
  /** When the payment settled, else when its record was written (ISO). */
  date: string;
  /** YYYY-MM of the date, in UTC. */
  month: string;
  counterparty: string;
  memo: string | null;
  category: DisclosurePayloadV1["category"];
  amount: bigint;
  reconciliation: "matched" | "needs_receipt";
  payment: BooksPaymentView;
};

/**
 * The ledger: one row per payment the server lists, from its record, newest first. A record for a
 * payment the server does not list is not shown, and money in (M1) is not part of the books.
 */
export function ledgerRows(
  payloads: readonly DisclosurePayloadV1[],
  payments: readonly BooksPaymentView[],
): LedgerRow[] {
  const rows = new Map<string, LedgerRow>();
  for (const payload of payloads) {
    if (payload.direction !== "out") continue;
    if (payload.kind !== "payment" && payload.kind !== "payroll_line") continue;
    const payment = payments.find((entry) => entry.id === payload.subject);
    if (!payment || rows.has(payment.id)) continue;
    const date = payment.settledAt ?? payload.created_at;
    rows.set(payment.id, {
      id: payment.id,
      kind: payload.kind,
      date,
      month: date.slice(0, 7),
      counterparty: payload.counterparty ?? "Counterparty not named",
      memo: payload.memo,
      category: payload.category,
      amount: BigInt(payload.amount),
      reconciliation: payment.reconciliation?.status ?? "needs_receipt",
      payment,
    });
  }
  // Payments settled at the same time (a payroll run's lines) by counterparty, then id, so the ledger
  // keeps one order whatever order the records arrive in.
  return [...rows.values()].sort(
    (a, b) =>
      (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
      a.counterparty.localeCompare(b.counterparty, "en") ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** The months that have rows, oldest first, at most the latest `limit`. */
export function monthsOf(rows: readonly LedgerRow[], limit = 6): string[] {
  return [...new Set(rows.map((row) => row.month))].sort().slice(-limit);
}

/** "Sep" or "September 2026" for a YYYY-MM month. */
export function monthLabel(month: string, long = false): string {
  const index = Number(month.slice(5, 7)) - 1;
  return long ? `${MONTHS_LONG[index] ?? month} ${month.slice(0, 4)}` : (MONTHS[index] ?? month);
}

/** "Jul to Sep 2026", "September 2026", or across years "Nov 2026 to Jan 2027". */
export function rangeLabel(months: readonly string[]): string {
  const first = months[0];
  const last = months.at(-1);
  if (!first || !last) return "";
  if (first === last) return monthLabel(first, true);
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  return sameYear
    ? `${monthLabel(first)} to ${monthLabel(last)} ${last.slice(0, 4)}`
    : `${monthLabel(first)} ${first.slice(0, 4)} to ${monthLabel(last)} ${last.slice(0, 4)}`;
}

export const sum = (rows: readonly LedgerRow[]) =>
  rows.reduce((total, row) => total + row.amount, 0n);

export function monthTotals(rows: readonly LedgerRow[], months: readonly string[]) {
  return months.map((month) => ({
    month,
    total: sum(rows.filter((row) => row.month === month)),
  }));
}

/** Money out by category, largest first. */
export function categoryTotals(rows: readonly LedgerRow[]) {
  const totals = new Map<LedgerRow["category"], bigint>();
  for (const row of rows) totals.set(row.category, (totals.get(row.category) ?? 0n) + row.amount);
  return [...totals.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => (a.total < b.total ? 1 : a.total > b.total ? -1 : 0));
}

export type LedgerFilter = {
  month: string | null;
  /** A category, "needs_receipt", or null for every row. */
  chip: LedgerRow["category"] | "needs_receipt" | null;
  search: string;
};

export const formatUsdc = (base: bigint) => `${formatTokenAmount(base, DECIMALS)} USDC`;

/** The rows the ledger shows; the search runs on the opened records in memory (AC-11.2). */
export function filterRows(rows: readonly LedgerRow[], filter: LedgerFilter): LedgerRow[] {
  const needle = filter.search.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter.month && row.month !== filter.month) return false;
    if (filter.chip === "needs_receipt" && row.reconciliation !== "needs_receipt") return false;
    if (filter.chip && filter.chip !== "needs_receipt" && row.category !== filter.chip) {
      return false;
    }
    if (!needle) return true;
    return [
      row.counterparty,
      row.memo ?? "",
      BOOKS_CATEGORY_LABEL[row.category],
      formatTokenAmount(row.amount, DECIMALS),
    ].some((value) => value.toLowerCase().includes(needle));
  });
}

/** An RFC 4180 field: quoted when it holds a comma, a quote or a line break. */
function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export const CSV_HEADER = [
  "date",
  "counterparty",
  "memo",
  "category",
  "amount",
  "currency",
  "type",
  "reconciliation",
  "transaction",
];

/** AC-11.4: the CSV of the rows the ledger shows, in the same order, generated in this tab. */
export function ledgerCsv(rows: readonly LedgerRow[]): string {
  const lines = [CSV_HEADER.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.date.slice(0, 10),
        row.counterparty,
        row.memo ?? "",
        BOOKS_CATEGORY_LABEL[row.category],
        formatTokenAmount(row.amount, DECIMALS),
        "USDC",
        row.kind === "payroll_line" ? "Payroll line" : "Payment",
        row.reconciliation === "matched" ? "Matched" : "Needs receipt",
        row.payment.chain?.signature ?? "",
      ]
        .map(field)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
