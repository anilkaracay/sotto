// My pay (F-12, step 2.6, component level): while the viewing key is locked no figure shows and the
// payments are said to be sealed; opened, the latest payslip shows the net, the gross and the tax
// withheld the payroll CSV gave, and who can read it (AC-12.1), the last 6 months and the payslips
// with their PDF buttons (AC-12.3), and "What your colleagues see" lists the transfers into the
// recipient's account without any amount (AC-12.2). With several organizations each group is named.
import type { DisclosurePayloadV1 } from "@sotto/sdk/disclosure";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PayGroupView, type PayGroupState } from "../app/app/[org]/pay/pay-panel.tsx";
import { payslipsOf } from "../lib/pay.ts";
import type { PayView } from "../lib/server/pay.ts";
import { expectAmountsInside, privacyOn } from "./helpers/amounts.ts";

const ORG = "3f1b6a2e-5c4d-4e8f-9a0b-1c2d3e4f5a6b";
const LINE = "a0000000-0000-4000-8000-000000000001";
const TOKEN = "3tsDBjBsSycu8Hp1XtQqGqGixNXgWQFyRKRfSXp2sDb6";
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();

const pay: PayView = {
  org: { id: ORG, displayName: "Northwind" },
  ownerWallet: "7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L",
  recipient: {
    displayName: "Maya Chen",
    roleTitle: "Design lead",
    wallet: "HmEvErXi8iX36Qi9ow6qb7MAUijbiHSUXx7Tiqvq3Srq",
  },
  tokenAccount: TOKEN,
  payments: [
    {
      id: LINE,
      kind: "payroll_line",
      status: "settled",
      settledAt: "2026-09-30T10:00:00.000Z",
      readers: ["Daniel Osei"],
    },
  ],
  chain: [
    {
      signature: "5Kq9Wm2r".padEnd(88, "1"),
      blockTime: "2026-09-30T10:00:05.000Z",
      from: "7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L",
      to: TOKEN,
    },
  ],
};

const line: DisclosurePayloadV1 = {
  v: 1,
  org: ORG,
  kind: "payroll_line",
  direction: "out",
  category: "payroll",
  subject: LINE,
  amount: "9400000000",
  currency: "USDC",
  memo: "Salary, September",
  gross: "10200000000",
  tax: "800000000",
  counterparty: "Maya Chen",
  signatures: [],
  created_at: "2026-09-30T10:00:00.000Z",
};

const render = (state: PayGroupState, grouped = false) =>
  renderToStaticMarkup(
    privacyOn(
      <PayGroupView
        orgName="Northwind"
        grouped={grouped}
        state={state}
        now={new Date("2026-09-30T12:00:00Z")}
        onRetry={() => undefined}
      />,
    ),
  );

describe("my pay (F-12)", () => {
  it("AC-12.1 shows no figure while locked, then the latest payslip with net, gross, tax and who can read it", () => {
    const locked = render({ kind: "loaded", pay, sealed: 1, slips: null, unverified: 0 });
    expect(text(locked)).toContain("1 payment is sealed to your viewing key.");
    expect(locked).not.toMatch(/\d USDC/);
    const open = render({
      kind: "loaded",
      pay,
      sealed: 1,
      slips: payslipsOf([line], pay),
      unverified: 0,
    });
    expectAmountsInside(open);
    expect(text(open)).toContain("September 2026 pay Paid 30 Sep 2026 to HmEv…3Srq");
    expect(text(open)).toContain(
      "Net pay Paid 9400 USDC Gross 10200 USDC Tax withheld (800 USDC) You, Northwind and Daniel Osei can read this",
    );
    expect(text(open)).toContain("Last 6 months Net, USDC");
    expect(open.match(/data-testid="pay-bar"/g)).toHaveLength(6);
    expect(text(open)).toContain(
      "September 2026 Paid 30 Sep 2026 · Payroll · Salary, September 9400 USDC PDF",
    );
  });

  it("AC-12.2 shows what the colleagues see: transfers into the account and their dates, never the amount", () => {
    const html = render({ kind: "loaded", pay, sealed: 1, slips: null, unverified: 0 });
    expect(text(html)).toContain(
      "What your colleagues see A payment from Northwind to your account, and when. Never the amount. 3tsD…sDb6 30 Sep 2026",
    );
    expect(html.match(/data-testid="colleagues-row"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Amount sealed"');
  });

  it("names each organization's group when several pay the recipient", () => {
    expect(text(render({ kind: "loading" }, true))).toContain(
      "From Northwind Reading your payments…",
    );
    expect(render({ kind: "loading" }, false)).not.toContain("pay-group-name");
  });
});
