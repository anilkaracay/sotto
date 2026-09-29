// My pay in the tab (F-12, step 2.6): one payslip per payment the server lists, from the recipient's
// own opened record, with the gross and the tax only when the payroll CSV gave them (AC-12.1); the net
// pay of the last 6 months; who can read a payslip in words; the organizations grouped with the page's
// first; and the payslip PDF made in the tab (AC-12.3): a valid one page PDF whose text holds the
// payslip, with text outside Latin-1 written without accents.
import type { DisclosurePayloadV1 } from "@sotto/sdk/disclosure";
import { describe, expect, it } from "vitest";
import {
  lastMonths,
  netByMonth,
  payOrgs,
  payslipsOf,
  payslipTitle,
  readersWords,
} from "../lib/pay.ts";
import { latin1, payslipLines, payslipPdf } from "../lib/payslip-pdf.ts";
import type { PayView } from "../lib/server/pay.ts";

const ORG = "3f1b6a2e-5c4d-4e8f-9a0b-1c2d3e4f5a6b";
const LINE = "a0000000-0000-4000-8000-000000000001";
const SINGLE = "a0000000-0000-4000-8000-000000000002";
const OTHER = "a0000000-0000-4000-8000-000000000003";

const pay: PayView = {
  org: { id: ORG, displayName: "Northwind" },
  ownerWallet: "7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L",
  recipient: {
    displayName: "Maya Chen",
    roleTitle: "Design lead",
    wallet: "HmEvErXi8iX36Qi9ow6qb7MAUijbiHSUXx7Tiqvq3Srq",
  },
  tokenAccount: "3tsDBjBsSycu8Hp1XtQqGqGixNXgWQFyRKRfSXp2sDb6",
  payments: [
    {
      id: LINE,
      kind: "payroll_line",
      status: "settled",
      settledAt: "2026-09-30T10:00:00.000Z",
      readers: ["Daniel Osei"],
    },
    {
      id: SINGLE,
      kind: "single",
      status: "settled",
      settledAt: "2026-07-15T10:00:00.000Z",
      readers: [],
    },
  ],
  chain: [],
};

function record(subject: string, extra: Partial<DisclosurePayloadV1>): DisclosurePayloadV1 {
  return {
    v: 1,
    org: ORG,
    kind: "payment",
    direction: "out",
    category: "supplier",
    subject,
    amount: "1000000",
    currency: "USDC",
    memo: null,
    gross: null,
    tax: null,
    counterparty: "Maya Chen",
    signatures: [],
    created_at: "2026-09-01T00:00:00.000Z",
    ...extra,
  };
}

const records = [
  record(LINE, {
    kind: "payroll_line",
    category: "payroll",
    amount: "9400000000",
    gross: "10200000000",
    tax: "800000000",
    memo: "Salary, September",
    signatures: ["5Kq9Wm2r"],
  }),
  record(SINGLE, { amount: "1250000", memo: "Invoice 7" }),
  // A record the server does not list is not a payslip.
  record(OTHER, { amount: "5" }),
];

describe("my pay in the tab (F-12)", () => {
  it("AC-12.1 shows one payslip per listed payment, newest first, net always and gross and tax when given", () => {
    const slips = payslipsOf(records, pay);
    expect(
      slips.map((slip) => [
        slip.id,
        slip.net,
        slip.gross,
        slip.tax,
        slip.readers,
        payslipTitle(slip),
      ]),
    ).toEqual([
      [LINE, 9_400_000_000n, 10_200_000_000n, 800_000_000n, ["Daniel Osei"], "September 2026"],
      [SINGLE, 1_250_000n, null, null, [], "Invoice 7"],
    ]);
    const months = lastMonths(new Date("2026-09-29T12:00:00Z"));
    expect(months).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(netByMonth(slips, months).map((entry) => entry.total)).toEqual([
      0n,
      0n,
      0n,
      1_250_000n,
      0n,
      9_400_000_000n,
    ]);
    expect(lastMonths(new Date("2026-02-10T00:00:00Z"), 3)).toEqual([
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    expect(readersWords("Northwind", [])).toBe("You and Northwind can read this");
    expect(readersWords("Northwind", ["Daniel Osei"])).toBe(
      "You, Northwind and Daniel Osei can read this",
    );
  });

  it("AC-12.1 groups the pay by organization, the page's first and the other paying ones by name", () => {
    const memberships = [
      { orgId: "c", orgName: "Zeta Labs", orgStatus: "active", role: "recipient" },
      { orgId: "a", orgName: "Northwind", orgStatus: "active", role: "recipient" },
      { orgId: "b", orgName: "Acme", orgStatus: "active", role: "recipient" },
      { orgId: "d", orgName: "Paused Co", orgStatus: "suspended", role: "recipient" },
      { orgId: "e", orgName: "Owned Co", orgStatus: "active", role: "owner" },
    ];
    expect(payOrgs(memberships, "a")).toEqual([
      { orgId: "a", orgName: "Northwind" },
      { orgId: "b", orgName: "Acme" },
      { orgId: "c", orgName: "Zeta Labs" },
    ]);
  });

  it("AC-12.3 makes the payslip PDF in the tab: one valid page whose text holds the payslip", () => {
    const [slip] = payslipsOf(records, pay);
    if (!slip) throw new Error("no payslip");
    const document = {
      orgName: "Northwind (Labs)",
      recipientName: "Elif Aydın",
      roleTitle: "Design lead",
      wallet: pay.recipient.wallet,
      slip,
    };
    expect(payslipLines(document).map((line) => line.text)).toEqual([
      "Payslip: September 2026",
      "Northwind (Labs)",
      "",
      "Paid to: Elif Aydın, Design lead",
      `Wallet: ${pay.recipient.wallet}`,
      "Paid on: 30 Sep 2026",
      "Memo: Salary, September",
      "",
      "Gross pay: 10200 USDC",
      "Tax withheld: 800 USDC",
      "Net pay: 9400 USDC",
      "",
      "Solana transaction: 5Kq9Wm2r",
      "Paid in confidential wUSDC on Solana: the amount is encrypted onchain.",
      "Made in your browser from your own sealed payment record. Sotto never saw these amounts.",
    ]);
    const pdf = new TextDecoder("latin1").decode(payslipPdf(document));
    expect(pdf.startsWith("%PDF-1.4\n")).toBe(true);
    expect(pdf.endsWith("%%EOF\n")).toBe(true);
    // The cross reference table points at each object, and startxref at the table.
    const startxref = Number(/startxref\n(\d+)\n/.exec(pdf)?.[1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe("xref");
    const offsets = [...pdf.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) =>
      Number(match[1]),
    );
    expect(offsets).toHaveLength(5);
    offsets.forEach((offset, index) => {
      expect(pdf.slice(offset, offset + 8)).toBe(`${index + 1} 0 obj\n`);
    });
    const stream = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/.exec(pdf);
    expect(Number(stream?.[1])).toBe(stream?.[2]?.length);
    // Parentheses escaped; the dotless i, outside Latin-1, in its plain form.
    expect(pdf).toContain("(Northwind \\(Labs\\)) Tj");
    expect(pdf).toContain("(Paid to: Elif Aydin, Design lead) Tj");
    expect(pdf).toContain("(Net pay: 9400 USDC) Tj");
    expect(latin1("Łódź café, Şişli, 日本")).toBe("Lódz café, Sisli, ??");
  });
});
