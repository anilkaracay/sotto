// The accountant's books in the tab (F-11, step 2.5): the ledger holds one row per payment the server
// lists, from the accountant's opened records, money out only (M1); the filters and the search run on
// the opened records in memory (AC-11.2); the CSV holds exactly the rows the ledger shows, in order,
// with RFC 4180 quoting (AC-11.4); the months, totals and categories are sums of those rows.
import type { DisclosurePayloadV1 } from "@sotto/sdk/disclosure";
import { describe, expect, it } from "vitest";
import {
  categoryTotals,
  filterRows,
  ledgerCsv,
  ledgerRows,
  monthsOf,
  monthTotals,
  rangeLabel,
  sum,
} from "../lib/books.ts";
import type { BooksPaymentView } from "../lib/server/books.ts";

const ORG = "3f1b6a2e-5c4d-4e8f-9a0b-1c2d3e4f5a6b";

function payment(id: string, settledAt: string, extra: Partial<BooksPaymentView> = {}) {
  return {
    id,
    kind: "single",
    status: "settled",
    settledAt,
    run: null,
    chain: { signature: `sig-${id.slice(-1)}`, from: "From111", to: "To111", blockTime: settledAt },
    screening: "clear",
    approvedBy: null,
    reconciliation: null,
    ...extra,
  } satisfies BooksPaymentView;
}

function payload(
  subject: string,
  amount: string,
  extra: Partial<DisclosurePayloadV1> = {},
): DisclosurePayloadV1 {
  return {
    v: 1,
    org: ORG,
    kind: "payment",
    direction: "out",
    category: "supplier",
    subject,
    amount,
    currency: "USDC",
    memo: null,
    gross: null,
    tax: null,
    counterparty: "Hollis Supply Co.",
    signatures: [],
    created_at: "2026-09-01T00:00:00.000Z",
    ...extra,
  };
}

const A = "a0000000-0000-4000-8000-000000000001";
const B = "a0000000-0000-4000-8000-000000000002";
const C = "a0000000-0000-4000-8000-000000000003";
const D = "a0000000-0000-4000-8000-000000000004";

const payments = [
  payment(A, "2026-07-15T10:00:00.000Z"),
  payment(B, "2026-08-31T10:00:00.000Z", {
    kind: "payroll_line",
    reconciliation: { status: "matched", updatedAt: "2026-09-01T00:00:00.000Z" },
  }),
  payment(C, "2026-09-28T10:00:00.000Z"),
];

const payloads = [
  payload(A, "38000000000", { memo: "Invoice 1042, housings" }),
  payload(B, "9400000000", {
    kind: "payroll_line",
    category: "payroll",
    counterparty: "Maya Chen",
    memo: "Salary, August",
  }),
  payload(C, "4120000000", { category: "software", counterparty: 'Stratus "Cloud", Inc.' }),
  // A record the server does not list, and money in: neither is part of the books.
  payload(D, "1000000"),
  payload(A, "1", { direction: "in" }),
];

describe("accountant books in the tab (F-11)", () => {
  it("AC-11.2 builds one row per listed payment from its opened record, newest first, money out only", () => {
    const rows = ledgerRows(payloads, payments);
    expect(rows.map((row) => [row.id, row.month, row.amount, row.reconciliation])).toEqual([
      [C, "2026-09", 4_120_000_000n, "needs_receipt"],
      [B, "2026-08", 9_400_000_000n, "matched"],
      [A, "2026-07", 38_000_000_000n, "needs_receipt"],
    ]);
    const months = monthsOf(rows);
    expect(months).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(rangeLabel(months)).toBe("Jul to Sep 2026");
    expect(monthTotals(rows, months).map((entry) => entry.total)).toEqual([
      38_000_000_000n,
      9_400_000_000n,
      4_120_000_000n,
    ]);
    expect(sum(rows)).toBe(51_520_000_000n);
    expect(categoryTotals(rows).map((entry) => entry.category)).toEqual([
      "supplier",
      "payroll",
      "software",
    ]);
  });

  it("AC-11.2 orders payments settled at the same time by counterparty, whatever order their records arrive in", () => {
    const at = "2026-09-30T12:00:00.000Z";
    const lines = [B, C, D].map((id) => payment(id, at, { kind: "payroll_line" }));
    const records = [
      payload(D, "3", { kind: "payroll_line", category: "payroll", counterparty: "Maya Chen" }),
      payload(B, "1", { kind: "payroll_line", category: "payroll", counterparty: "Idris Kaya" }),
      payload(C, "2", { kind: "payroll_line", category: "payroll", counterparty: "Lena Novak" }),
    ];
    const order = (list: DisclosurePayloadV1[]) =>
      ledgerRows(list, lines).map((row) => row.counterparty);
    expect(order(records)).toEqual(["Idris Kaya", "Lena Novak", "Maya Chen"]);
    expect(order([...records].reverse())).toEqual(["Idris Kaya", "Lena Novak", "Maya Chen"]);
  });

  it("AC-11.2 filters by month, category and needs receipt, and searches the opened records in memory", () => {
    const rows = ledgerRows(payloads, payments);
    const ids = (filter: Parameters<typeof filterRows>[1]) =>
      filterRows(rows, filter).map((row) => row.id);
    expect(ids({ month: "2026-08", chip: null, search: "" })).toEqual([B]);
    expect(ids({ month: null, chip: "software", search: "" })).toEqual([C]);
    expect(ids({ month: null, chip: "needs_receipt", search: "" })).toEqual([C, A]);
    expect(ids({ month: null, chip: null, search: "housings" })).toEqual([A]);
    expect(ids({ month: null, chip: null, search: "9400" })).toEqual([B]);
    expect(ids({ month: null, chip: null, search: "maya" })).toEqual([B]);
    expect(ids({ month: "2026-07", chip: "payroll", search: "" })).toEqual([]);
  });

  it("AC-11.4 exports exactly the rows the ledger shows as CSV, quoted where needed", () => {
    const rows = ledgerRows(payloads, payments);
    const shown = filterRows(rows, { month: null, chip: "needs_receipt", search: "" });
    expect(ledgerCsv(shown).split("\r\n")).toEqual([
      "date,counterparty,memo,category,amount,currency,type,reconciliation,transaction",
      '2026-09-28,"Stratus ""Cloud"", Inc.",,Software,4120,USDC,Payment,Needs receipt,sig-3',
      '2026-07-15,Hollis Supply Co.,"Invoice 1042, housings",Supplier,38000,USDC,Payment,Needs receipt,sig-1',
      "",
    ]);
    expect(ledgerCsv([]).split("\r\n")).toHaveLength(2);
  });
});
