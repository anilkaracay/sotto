// What the chain shows (AC-05.3, step 2.5, component level): the overview's panel renders the rows of
// chain_activity and nothing else: each instruction in words with its accounts and transaction, a
// deposit's and a withdrawal's public amounts, "Sealed" for every confidential transfer, and the
// amounts the chain shows but Sotto does not keep as "Public onchain"; the loading, empty and error
// states in words.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChainView, type ChainState } from "../app/app/[org]/overview/chain-panel.tsx";
import type { ChainActivityView } from "../lib/server/chain-activity.ts";
import { expectAmountsInside, privacyOn } from "./helpers/amounts.ts";

const ORG_ACCOUNT = "HmEvErXi8iX36Qi9ow6qb7MAUijbiHSUXx7Tiqvq3Srq";
const RECIPIENT = "3tsDBjBsSycu8Hp1XtQqGqGixNXgWQFyRKRfSXp2sDb6";
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();

let next = 0;
function row(
  type: ChainActivityView["type"],
  publicAmount: string | null = null,
  counterparty: string | null = null,
): ChainActivityView {
  next += 1;
  return {
    id: String(next),
    signature: `5Kq9Wm2r${"1".repeat(80)}`.slice(0, 88),
    slot: String(1000 + next),
    blockTime: "2026-09-29T10:00:00.000Z",
    type,
    tokenAccount: ORG_ACCOUNT,
    counterparty,
    publicAmount,
  };
}

const render = (state: ChainState) =>
  renderToStaticMarkup(
    privacyOn(<ChainView state={state} wrapLabel="devnet test wrap" onRetry={() => undefined} />),
  );

describe("what the chain shows (AC-05.3)", () => {
  it("AC-05.3 lists public activity only: public amounts for deposits and withdrawals, sealed transfers", () => {
    const html = render({
      kind: "loaded",
      activity: [
        row("transfer_out", null, RECIPIENT),
        row("withdraw", "3000000"),
        row("transfer_in", null, RECIPIENT),
        row("deposit", "20000000"),
        row("apply_pending"),
        row("wrap"),
        row("account_setup"),
      ],
    });
    expectAmountsInside(html);
    const shown = text(html);
    expect(shown).toContain("Confidential transfer out HmEv…3Srq → 3tsD…sDb6 5Kq9Wm2r… Sealed");
    expect(shown).toContain("Withdrawal to the public balance HmEv…3Srq 5Kq9Wm2r… 3 wUSDC");
    expect(shown).toContain("Confidential transfer in 3tsD…sDb6 → HmEv…3Srq 5Kq9Wm2r… Sealed");
    expect(shown).toContain("Deposit to the confidential balance HmEv…3Srq 5Kq9Wm2r… 20 wUSDC");
    expect(shown).toContain("Pending balance applied HmEv…3Srq 5Kq9Wm2r… No amount");
    expect(shown).toContain("USDC wrapped to wUSDC HmEv…3Srq 5Kq9Wm2r… Public onchain");
    expect(shown).toContain("wUSDC figures are the devnet test wrap.");
    // Two rows carry a number, the deposit's and the withdrawal's; every transfer is sealed.
    expect(html.match(/\d+ wUSDC/g)).toEqual(["3 wUSDC", "20 wUSDC"]);
    expect(html.match(/data-type="transfer_(in|out)"/g)).toHaveLength(2);
  });

  it("says when there is nothing yet, while it reads, and when it cannot read", () => {
    expect(text(render({ kind: "loaded", activity: [] }))).toContain("Nothing on Solana yet.");
    expect(text(render({ kind: "loading" }))).toContain(
      "Reading your account's activity on Solana…",
    );
    expect(text(render({ kind: "error" }))).toContain(
      "What the chain shows could not be loaded. Try again.",
    );
  });
});
