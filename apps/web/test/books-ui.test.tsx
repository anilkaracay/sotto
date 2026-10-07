// The accountant's Books screen (F-11, step 2.5, component level): the scope banner says who shared
// the books, what they read and until when (AC-11.1); while the viewing key is locked no figure shows
// and the records are said to be sealed; opened, the money out hero, the categories and the ledger
// are sums and rows of the opened records only (AC-11.2), the reconciliation card counts the payments
// that need a receipt (AC-11.3), and no "Money in" figure exists anywhere (M1).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BooksScreen } from "../app/app/[org]/books/books-panel.tsx";
import { ledgerRows } from "../lib/books.ts";
import type { BooksPaymentView, BooksView } from "../lib/server/books.ts";
import { expectAmountsInside, privacyOn } from "./helpers/amounts.ts";

const ORG = "3f1b6a2e-5c4d-4e8f-9a0b-1c2d3e4f5a6b";
const OWNER_WALLET = "7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L";
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();

const payment = (id: string, settledAt: string, matched = false): BooksPaymentView => ({
  id,
  kind: "single",
  status: "settled",
  settledAt,
  run: null,
  chain: null,
  screening: "clear",
  approvedBy: null,
  reconciliation: matched ? { status: "matched", updatedAt: settledAt } : null,
});

const A = "a0000000-0000-4000-8000-000000000001";
const B = "a0000000-0000-4000-8000-000000000002";
const payments = [
  payment(A, "2026-08-14T10:00:00.000Z", true),
  payment(B, "2026-09-28T10:00:00.000Z"),
];
const books: BooksView = {
  org: { id: ORG, displayName: "Northwind" },
  ownerWallet: OWNER_WALLET,
  grants: [
    {
      id: "g0000000-0000-4000-8000-000000000001",
      scope: "period",
      periodFrom: "2026-07-01",
      periodTo: "2026-09-30",
      expiresAt: "2027-01-01T00:00:00.000Z",
      activatedAt: "2026-07-01T00:00:00.000Z",
      grantedBy: { name: "Elif Aydin", wallet: OWNER_WALLET },
    },
  ],
  payments,
};
const record = (subject: string, amount: string, counterparty: string, memo: string) => ({
  v: 1 as const,
  org: ORG,
  kind: "payment" as const,
  direction: "out" as const,
  category: "supplier" as const,
  subject,
  amount,
  currency: "USDC" as const,
  memo,
  gross: null,
  tax: null,
  counterparty,
  signatures: [],
  created_at: "2026-09-28T10:00:00.000Z",
});

const render = (rows: ReturnType<typeof ledgerRows> | null) =>
  renderToStaticMarkup(
    privacyOn(
      <BooksScreen
        books={books}
        payments={payments}
        rows={rows}
        unverified={0}
        problem={null}
        onReconcile={async () => undefined}
      />,
    ),
  );

describe("the accountant's Books screen (F-11)", () => {
  it("AC-11.1 shows the scope banner: who shared the books, what they read and until when", () => {
    const shown = text(render(null));
    expect(shown).toContain("Northwind, read only until 31 Dec 2026 Books");
    expect(shown).toContain(
      "Shared by Elif Aydin · Every amount, 1 Jul 2026 to 30 Sep 2026 · Until 31 Dec 2026 · Read only, never control of funds",
    );
  });

  it("AC-11.2 shows no figure while the viewing key is locked, and only sums of the opened records once it is open", () => {
    const locked = render(null);
    expect(text(locked)).toContain("2 records are sealed to your viewing key.");
    expect(text(locked)).toContain("Money out Sealed Unlock to see");
    expect(locked).not.toMatch(/\d USDC/);
    const rows = ledgerRows(
      [
        record(A, "27600000000", "Nordlicht GmbH", "Invoice 298"),
        record(B, "38000000000", "Hollis Supply Co.", "Invoice 1042"),
      ],
      payments,
    );
    const open = render(rows);
    expectAmountsInside(open);
    expect(text(open)).toContain("Money out, Aug to Sep 2026 Decrypted for you 65600 USDC");
    // The latest month is selected: its bar is lit and the ledger shows its rows.
    expect(text(open)).toContain("September 2026 38000 USDC");
    expect(open.match(/data-testid="ledger-row"/g)).toHaveLength(1);
    expect(text(open)).toContain(
      "Hollis Supply Co. Invoice 1042 Supplier Needs receipt 38000 USDC",
    );
    expect(text(open)).toContain("By category Supplier 65600 USDC");
    expect(text(open + locked)).not.toMatch(/money in/i);
  });

  it("AC-11.3 counts the payments that need a receipt, by their reconciliation status", () => {
    expect(text(render(null))).toContain("Reconciliation 1 needs a receipt");
  });
});
