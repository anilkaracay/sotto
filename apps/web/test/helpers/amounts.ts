// The privacy screen's coverage check on rendered markup (F-15, AC-15.1; step 2.9): the text of the
// markup with every `Amount` (data-amount) taken out must hold no currency formatted text. The
// localnet specs run the same check on the live pages (tests/e2e/helpers.ts).
import { createElement, type ReactElement, type ReactNode } from "react";
import { expect } from "vitest";
import { PrivacyContext } from "../../app/app/_components/privacy.tsx";
import { AMOUNT_TEXT } from "../../lib/amount-text.ts";

/** The markup's visible text with every data-amount element and every script or style removed. */
export function textOutsideAmounts(html: string): string {
  let rest = html.replace(/<(script|style)\b[\s\S]*?<\/\1>/g, " ");
  // Each element carrying data-amount, through its matching close tag (nested tags counted).
  for (;;) {
    const open = /<(\w+)\b[^>]*\sdata-amount=""[^>]*?(\/?)>/.exec(rest);
    if (!open) break;
    const [tag, name, selfClosing] = open;
    let end = open.index + tag.length;
    if (!selfClosing && name !== "input") {
      const pattern = new RegExp(`<(/?)${name}\\b[^>]*>`, "g");
      pattern.lastIndex = end;
      let depth = 1;
      for (let match = pattern.exec(rest); match; match = pattern.exec(rest)) {
        depth += match[1] ? -1 : 1;
        if (depth === 0) {
          end = match.index + match[0].length;
          break;
        }
      }
    }
    rest = `${rest.slice(0, open.index)} • ${rest.slice(end)}`;
  }
  // Inline formatting joins its text ("<b>5</b> USDC"); any other tag separates, as cells do.
  return rest
    .replace(/<\/?(?:b|i|em|strong|small|span)\b[^>]*>/g, "")
    .replace(/<[^>]+>/g, "\n")
    .replaceAll("&#x27;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

/** Fails when currency formatted text is shown outside `Amount`, naming each. */
export function expectAmountsInside(html: string): void {
  const outside = textOutsideAmounts(html).match(new RegExp(AMOUNT_TEXT.source, "g")) ?? [];
  expect(outside, "currency formatted text outside Amount").toEqual([]);
}

/** The node inside a privacy screen that is on, as the app shows it after the toggle. */
export function privacyOn(node: ReactNode): ReactElement {
  return createElement(
    PrivacyContext.Provider,
    { value: { on: true, toggle: () => undefined } },
    node,
  );
}
