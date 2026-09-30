// The privacy screen (F-15, AC-15.1; step 2.9): every amount renders through `Amount`, blurred while
// the screen is on and shown one at a time on hover or focus; messages with amounts wrap each one;
// the choice is one boolean per device in localStorage and nothing else is written; the blur has no
// motion when the reader asks for less. The views' own tests render with the screen on and fail on
// currency formatted text outside `Amount` (helpers/amounts.ts); the localnet specs check each page.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AMOUNT_TEXT, splitAmounts } from "../lib/amount-text.ts";
import {
  Amount,
  PRIVACY_STORAGE_KEY,
  PrivacyProvider,
  readStored,
  togglePrivacy,
  WithAmounts,
} from "../app/app/_components/privacy.tsx";
import { expectAmountsInside, privacyOn, textOutsideAmounts } from "./helpers/amounts.ts";

/** A window whose localStorage records every write. */
function fakeWindow(options: { blocked?: boolean } = {}) {
  const items = new Map<string, string>();
  const writes: string[] = [];
  const storage = {
    getItem: (key: string) => {
      if (options.blocked) throw new Error("SecurityError");
      return items.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (options.blocked) throw new Error("SecurityError");
      writes.push(key);
      items.set(key, value);
    },
  };
  vi.stubGlobal("window", {
    localStorage: storage,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
  return { items, writes };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the privacy screen (F-15)", () => {
  it("AC-15.1 finds every currency formatted amount in a message and wraps each in Amount", () => {
    expect(splitAmounts("Funded 5 wUSDC; 0.05 SOL fee, at least $100,000.")).toEqual([
      { amount: false, text: "Funded " },
      { amount: true, text: "5 wUSDC" },
      { amount: false, text: "; " },
      { amount: true, text: "0.05 SOL" },
      { amount: false, text: " fee, at least " },
      { amount: true, text: "$100,000" },
      { amount: false, text: "." },
    ]);
    for (const shown of ["12.5 USDC", "30 wUSDC", "$2.5M", "$10k", "1,250.75 USDC"]) {
      expect(shown.match(new RegExp(AMOUNT_TEXT.source, "g"))).toEqual([shown]);
    }
    // Words that only mention the currency, and a date next to it in another cell, are not amounts.
    expect("USDC wrapped to wUSDC".match(new RegExp(AMOUNT_TEXT.source, "g"))).toBeNull();
    expect("30 Sep 2026\nUSDC wrapped".match(new RegExp(AMOUNT_TEXT.source, "g"))).toBeNull();

    const html = renderToStaticMarkup(
      privacyOn(<WithAmounts>{"Withdrew 3 wUSDC and unwrapped it to 3 USDC."}</WithAmounts>),
    );
    expect(html.match(/data-amount=""/g)).toHaveLength(2);
    expectAmountsInside(html);
  });

  it("AC-15.1 blurs amounts only while on, and makes each one focusable then, except inside a button", () => {
    const off = renderToStaticMarkup(<Amount>5 USDC</Amount>);
    expect(off).toBe('<span class="amount" data-amount="">5 USDC</span>');
    const on = renderToStaticMarkup(privacyOn(<Amount>5 USDC</Amount>));
    expect(on).toBe('<span class="amount" data-amount="" tabindex="0">5 USDC</span>');
    const inButton = renderToStaticMarkup(privacyOn(<Amount inControl>$10</Amount>));
    expect(inButton).not.toContain("tabindex");
    // The provider marks the tree it covers; on the server (no stored choice) it is off.
    expect(renderToStaticMarkup(<PrivacyProvider>x</PrivacyProvider>)).toBe(
      '<div class="root" data-privacy="off">x</div>',
    );
    const css = readFileSync(
      new URL("../app/app/_components/privacy.module.css", import.meta.url),
      "utf8",
    );
    expect(css).toMatch(/\.root\[data-privacy="on"\] \.amount \{\s*filter: blur\(7px\);/);
    expect(css).toContain('.root[data-privacy="on"] .amount:hover');
    expect(css).toContain('.root[data-privacy="on"] .amount:focus-visible');
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.amount \{\s*transition: none;/,
    );
  });

  it("AC-15.1 fails a page that shows currency formatted text outside Amount", () => {
    const leaky = renderToStaticMarkup(
      privacyOn(
        <p>
          Paid <Amount>5 USDC</Amount> of <b>7</b> USDC
        </p>,
      ),
    );
    expect(textOutsideAmounts(leaky)).toBe("Paid • of 7 USDC");
    expect(() => expectAmountsInside(leaky)).toThrow(/outside Amount/);
  });

  it("AC-15.1 keeps the choice per device as one boolean in localStorage and writes nothing else", () => {
    const { items, writes } = fakeWindow();
    expect(readStored()).toBe(false);
    togglePrivacy();
    expect(readStored()).toBe(true);
    expect(items.get(PRIVACY_STORAGE_KEY)).toBe("on");
    togglePrivacy();
    expect(readStored()).toBe(false);
    expect(items.get(PRIVACY_STORAGE_KEY)).toBe("off");
    expect([...new Set(writes)]).toEqual([PRIVACY_STORAGE_KEY]);
    expect([...items.keys()]).toEqual([PRIVACY_STORAGE_KEY]);

    // With storage blocked, the choice still holds for the page.
    fakeWindow({ blocked: true });
    togglePrivacy();
    expect(readStored()).toBe(true);
    togglePrivacy();
    expect(readStored()).toBe(false);
  });
});
