// Token amounts as exact decimal text (no floating point): what the UI shows and what a person types.
/** An amount in base units as a decimal number of tokens, exactly (no floating point). */
export function formatTokenAmount(baseUnits: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0)
    throw new Error("decimals must be a whole number");
  const negative = baseUnits < 0n;
  const digits = (negative ? -baseUnits : baseUnits).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? digits.slice(-decimals).replace(/0+$/, "") : "";
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/**
 * A decimal number of tokens typed by a person, as base units, exactly: digits with at most
 * `decimals` digits after one dot, more than zero. Null when the text is not such an amount.
 */
export function parseTokenAmount(text: string, decimals: number): bigint | null {
  const match = /^(\d{1,15})(?:\.(\d+))?$/.exec(text.trim());
  if (!match?.[1]) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  const units = BigInt(match[1] + fraction.padEnd(decimals, "0"));
  return units > 0n ? units : null;
}
