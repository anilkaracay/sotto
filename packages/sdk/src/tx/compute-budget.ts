// Compute budget rules (06 section 9, Q-08): the app always sets its own compute budget.

export const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;

/** Priority fee cap in micro-lamports per compute unit ("capped by config"). */
export const DEFAULT_PRIORITY_FEE_CAP_MICRO_LAMPORTS = 1_000_000n;

/** Compute unit limit: simulated usage plus 20 percent, at most 1.4 million. */
export function computeUnitLimitFromSimulation(unitsConsumed: bigint | number): number {
  const units =
    typeof unitsConsumed === "bigint" ? unitsConsumed : BigInt(Math.ceil(unitsConsumed));
  if (units < 0n) throw new Error("simulated compute units must not be negative");
  const withMargin = (units * 12n + 9n) / 10n; // ceil(units * 1.2)
  return Number(
    withMargin > BigInt(MAX_COMPUTE_UNIT_LIMIT) ? BigInt(MAX_COMPUTE_UNIT_LIMIT) : withMargin,
  );
}

/**
 * Priority fee: the 75th percentile (nearest rank) of recent prioritization fees for the involved
 * accounts, capped. No samples means no priority fee.
 */
export function priorityFeeFromRecentFees(
  fees: readonly { prioritizationFee: bigint | number }[],
  capMicroLamports: bigint = DEFAULT_PRIORITY_FEE_CAP_MICRO_LAMPORTS,
): bigint {
  if (fees.length === 0) return 0n;
  const sorted = fees
    .map((fee) => BigInt(fee.prioritizationFee))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const p75 = sorted[Math.ceil(0.75 * sorted.length) - 1] ?? 0n;
  return p75 > capMicroLamports ? capMicroLamports : p75;
}
