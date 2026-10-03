// Currency formatted text (F-15, AC-15.1; step 2.9): "12.5 USDC", "30 wUSDC", "0.05 SOL", "$100,000",
// "$2.5M", and since step 4.3 "48200 devUSD", "30 wdevUSD" and "100k devUSD", with at most one space
// (or no-break space) inside. The privacy screen's `WithAmounts` wraps each match of a message in `Amount`, and the
// localnet specs fail a page that shows a match outside `Amount`. No React, no server only imports.
export const AMOUNT_TEXT =
  /\$[ \u00a0]?\d[\d,]*(?:\.\d+)?[kM]?|\d[\d,]*(?:\.\d+)?[kM]?[ \u00a0]?(?:w?USDC|w?devUSD|SOL)\b/g;

/** The text split into plain parts and amounts, in order. */
export function splitAmounts(text: string): { amount: boolean; text: string }[] {
  const parts: { amount: boolean; text: string }[] = [];
  let last = 0;
  for (const match of text.matchAll(new RegExp(AMOUNT_TEXT.source, "g"))) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ amount: false, text: text.slice(last, start) });
    parts.push({ amount: true, text: match[0] });
    last = start + match[0].length;
  }
  if (last < text.length) parts.push({ amount: false, text: text.slice(last) });
  return parts;
}
