// Step 4.11 (D-38): every blocked payment in three parts, what happened, why, and a button that
// fixes it in place. One test per reason on the founder's list: the public viewing key not
// registered, the keys locked, a recipient who cannot receive, the confidential balance too low
// (from pending, from public, from nowhere), too little SOL (the faucet, then faucet.solana.com),
// and a signature the wallet rejected or refused (the way to devnet in Phantom and Solflare). The
// blocks run against a ledger in tests/e2e/localnet/guidance.spec.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  InsufficientGuide,
  insufficientPlan,
  LockedGuide,
  NoSolGuide,
  PAY_MIN_LAMPORTS,
  RecipientGuide,
  ViewingKeyGuide,
  WalletGuide,
} from "../app/app/[org]/payments/new/pay-guides.tsx";
import { WALLET_REFUSED_TRANSACTION } from "../lib/client/transactions.ts";
import { WALKTHROUGH_WALLETS } from "../lib/walkthrough.ts";
import { expectAmountsInside, privacyOn } from "./helpers/amounts.ts";

const nothing = () => undefined;
const html = (node: Parameters<typeof privacyOn>[0]) => renderToStaticMarkup(privacyOn(node));
const text = (markup: string) =>
  markup
    // Inline tags join their text, as on the page; any other tag separates.
    .replace(/<\/?(?:b|span|a)\b[^>]*>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&#x27;", "'")
    .replace(/\s+/g, " ")
    .trim();
/** The block's three parts: the bold line, the reason, and its buttons with whether each is disabled. */
function parts(markup: string, id: string) {
  expect(markup).toContain(`data-testid="guidance-${id}"`);
  expect(markup).toContain('role="alert"');
  const what = /<b>([\s\S]*?)<\/b>/.exec(markup)?.[1] ?? "";
  const buttons = [...markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(
    ([, attributes = "", label = ""]) => ({
      label: text(label),
      disabled: /\sdisabled=""/.test(attributes),
    }),
  );
  return { what: text(what), all: text(markup), buttons };
}

const U = 1_000_000n;
const balances = { need: 100n * U, available: 0n, pending: 0n, publicBase: 1_000_000n * U };
const insufficient = (over: Partial<Parameters<typeof InsufficientGuide>[0]> = {}) =>
  html(
    <InsufficientGuide
      {...balances}
      symbol="devUSD"
      wrappedSymbol="wdevUSD"
      text=""
      onText={nothing}
      valid
      canSend
      busy={null}
      problem={null}
      onFix={nothing}
      {...over}
    />,
  );

describe("a blocked payment says what happened, why, and fixes it in place", () => {
  it("the public viewing key is not registered: Register public viewing key", () => {
    const block = parts(
      html(<ViewingKeyGuide busy={false} canSign problem={null} onRegister={nothing} />),
      "viewing-key",
    );
    expect(block.what).toBe("Your public viewing key is not registered yet.");
    expect(block.all).toContain("A payment's details are sealed to it");
    expect(block.all).toContain("sends no transaction");
    expect(block.buttons).toEqual([{ label: "Register public viewing key", disabled: false }]);
    // Never the word that named the wrong half, nor a page to go to.
    expect(block.all).not.toMatch(/Create|Account setup page/);
    const waiting = parts(
      html(<ViewingKeyGuide busy canSign problem="Declined." onRegister={nothing} />),
      "viewing-key",
    );
    expect(waiting.buttons).toEqual([{ label: "Waiting for your wallet…", disabled: true }]);
    expect(waiting.all).toContain("Declined.");
  });

  it("the keys are locked in the tab: Unlock my keys", () => {
    const block = parts(
      html(<LockedGuide busy={false} canUnlock problem={null} onUnlock={nothing} />),
      "locked",
    );
    expect(block.what).toBe("Your keys are locked in this tab.");
    expect(block.all).toContain("two signatures and sends no transaction");
    expect(block.buttons).toEqual([{ label: "Unlock my keys", disabled: false }]);
  });

  it("the recipient cannot receive yet: said plainly, with the demo recipient offered", () => {
    const block = parts(
      html(
        <RecipientGuide
          name="Maya Okafor"
          reason="Their confidential account is not set up yet."
          demoName="Atlas Freight (demo recipient)"
          onPayDemo={nothing}
        />,
      ),
      "recipient",
    );
    expect(block.what).toBe("Maya Okafor cannot receive a confidential payment yet.");
    expect(block.all).toContain("Their confidential account is not set up yet.");
    expect(block.buttons).toEqual([
      { label: "Pay Atlas Freight (demo recipient) instead", disabled: false },
    ]);
    // A company without the demo recipient is not offered one.
    const none = parts(
      html(<RecipientGuide name="Maya Okafor" reason="r" demoName={null} onPayDemo={nothing} />),
      "recipient",
    );
    expect(none.buttons).toEqual([]);
  });

  it("the confidential balance is too low: both balances, and the move prefilled to cover the payment", () => {
    expect(insufficientPlan(balances)).toEqual({
      missing: 100n * U,
      fromPending: false,
      shortfall: 100n * U,
      coverable: true,
    });
    const markup = insufficient();
    const block = parts(markup, "insufficient");
    expect(block.what).toBe(
      "Your confidential balance does not cover 100 devUSD. Nothing was sent.",
    );
    expect(block.all).toContain(
      "A confidential payment is paid from the available confidential balance only.",
    );
    expect(block.all).toContain("Available, confidential: 0 wdevUSD");
    expect(block.all).toContain("Pending, confidential: 0 wdevUSD");
    expect(block.all).toContain("Public, in your wallet: 1000000 devUSD");
    expect(markup).toMatch(/data-testid="guidance-move-amount"[^>]*value="100"/);
    expect(block.buttons).toEqual([
      { label: "Move devUSD to confidential balance", disabled: false },
    ]);
    expect(block.all).toContain("Your wallet will ask 2 times");
    // Every number of the block is under the privacy screen.
    expectAmountsInside(markup);

    // Part of it is there already: only the rest is prefilled.
    const some = { ...balances, need: 250n * U, available: 40n * U, pending: 10n * U };
    expect(insufficientPlan(some)).toMatchObject({ missing: 210n * U, shortfall: 200n * U });
    expect(insufficient(some)).toMatch(/data-testid="guidance-move-amount"[^>]*value="200"/);
    // An amount typed below the rest, or a wallet that is signing: the button waits.
    expect(parts(insufficient({ valid: false }), "insufficient").buttons[0]?.disabled).toBe(true);
    const moving = parts(
      insufficient({ busy: "Wrapping 100 devUSD and depositing it…" }),
      "insufficient",
    );
    expect(moving.buttons[0]?.disabled).toBe(true);
    expect(moving.all).toContain("Wrapping 100 devUSD and depositing it…");
  });

  it("the pending balance is not applied: Apply pending balance", () => {
    const pending = { ...balances, pending: 100n * U, publicBase: 0n };
    expect(insufficientPlan(pending)).toMatchObject({ fromPending: true, shortfall: 0n });
    const block = parts(insufficient(pending), "insufficient");
    expect(block.all).toContain("Pending, confidential: 100 wdevUSD");
    expect(block.buttons).toEqual([{ label: "Apply pending balance", disabled: false }]);
    expect(block.all).toContain("Your wallet will ask once: one transaction that applies it.");
    expect(block.all).not.toContain("Move devUSD");
  });

  it("no balance covers the amount: said so, with nothing to press", () => {
    const poor = { ...balances, publicBase: 5n * U };
    expect(insufficientPlan(poor).coverable).toBe(false);
    const block = parts(insufficient(poor), "insufficient");
    expect(block.buttons).toEqual([]);
    expect(block.all).toContain(
      "Your wallet's public balance does not cover the rest either. Pay a smaller amount.",
    );
  });

  it("no SOL for fees: Get test SOL in place, and faucet.solana.com when Sotto's faucet cannot send", () => {
    expect(PAY_MIN_LAMPORTS).toBe(13_000_000n);
    const guide = (over: Partial<Parameters<typeof NoSolGuide>[0]> = {}) =>
      html(
        <NoSolGuide
          lamports={2_000_000n}
          devnet
          limited={false}
          busy={false}
          note={null}
          onGet={nothing}
          onRetry={nothing}
          {...over}
        />,
      );
    const block = parts(guide(), "no-sol");
    expect(block.what).toBe(
      "Your wallet holds 0.002 SOL, too little for this payment. Nothing was sent.",
    );
    expect(block.all).toContain("its proof accounts hold about 0.0122 SOL until they close");
    expect(block.buttons).toEqual([{ label: "Get test SOL", disabled: false }]);
    expect(block.all).not.toContain("faucet.solana.com");

    const limited = guide({ limited: true });
    const elsewhere = parts(limited, "no-sol");
    expect(elsewhere.all).toContain(
      "Sotto's faucet cannot send this wallet test SOL right now. Get devnet SOL for it at faucet.solana.com.",
    );
    expect(limited).toContain('href="https://faucet.solana.com"');
    expect(elsewhere.buttons).toEqual([{ label: "Try again", disabled: false }]);

    // Off devnet there is no faucet to name.
    const local = parts(guide({ devnet: false }), "no-sol");
    expect(local.all).toContain("Send SOL to this wallet first.");
    expect(local.all).not.toContain("faucet");
    expect(local.buttons).toEqual([{ label: "Try again", disabled: false }]);
  });

  it("an approval rejected in the wallet: nothing was sent, the form is kept, Try again", () => {
    const block = parts(
      html(
        <WalletGuide
          message="You cancelled in your wallet. Nothing was sent. Phantom said: User rejected the request."
          devnet
          canRetry
          onRetry={nothing}
        />,
      ),
      "wallet",
    );
    expect(block.what).toBe(
      "You cancelled in your wallet. Nothing was sent. Phantom said: User rejected the request. Your form is kept.",
    );
    expect(block.buttons).toEqual([{ label: "Try again", disabled: false }]);
  });

  it("a wallet on the wrong network: asked after the fact, with the way to devnet in Phantom and Solflare", () => {
    const markup = html(
      <WalletGuide message={WALLET_REFUSED_TRANSACTION} devnet canRetry onRetry={nothing} />,
    );
    const block = parts(markup, "wallet");
    expect(block.what).toBe(
      "Your wallet did not sign the transaction, so nothing was sent. Sotto had simulated it on this network and it would have succeeded, so the refusal comes from the wallet itself. Your form is kept.",
    );
    expect(block.all).toContain("Is your wallet on devnet?");
    expect(markup).toContain('data-testid="devnet-steps"');
    const { phantom, solflare } = WALKTHROUGH_WALLETS;
    for (const word of [
      "Phantom:",
      phantom.settings,
      phantom.toggle,
      "Solflare:",
      solflare.setting,
      solflare.network,
    ]) {
      expect(block.all).toContain(word);
    }
    expect(block.buttons).toEqual([{ label: "Try again", disabled: false }]);
    // Off devnet the block does not speak of devnet; while a payment runs the button waits.
    const local = parts(
      html(<WalletGuide message="m" devnet={false} canRetry={false} onRetry={nothing} />),
      "wallet",
    );
    expect(local.all).not.toContain("devnet");
    expect(local.buttons).toEqual([{ label: "Try again", disabled: true }]);
  });
});
