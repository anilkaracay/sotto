// The overview's balance history (AC-05.2, 07 section 6; step 2.12), computed in the owner's browser
// from the owner's balance snapshots (decrypted available plus pending, one per UTC day at most) and
// the public deposits and withdrawals the chain shows. No server holds a balance series in plaintext.
// One bar per month over the last six months, never extrapolated:
// - a month with snapshots: its last snapshot, plus the deposits and less the withdrawals after that
//   snapshot within the month;
// - a month without a snapshot but with public flows: the last known balance before it (the previous
//   month's value, carried through months without data) plus and less that month's flows; with no
//   earlier snapshot there is nothing to add them to, so no bar;
// - a month with neither: no bar.
// A history shorter than six months shows only its months, from the first snapshot's. The page reads
// the snapshots from the month before the window on, and says whether any older one exists. No server
// only imports.

export const HISTORY_MONTHS = 6;

export type BalanceSnapshot = {
  /** The snapshot's UTC day, its subject. */
  day: string;
  /** When it was taken (the payload's created_at, ISO 8601 UTC). */
  at: string;
  available: bigint;
  pending: bigint;
};

export type PublicFlow = {
  /** The transaction's block time (ISO 8601 UTC). */
  at: string;
  type: "deposit" | "withdraw";
  /** Base units, public onchain. */
  amount: bigint;
};

export type BalanceHistory =
  | { kind: "empty" }
  | {
      kind: "history";
      /** Oldest first; `balance` null where the month has no bar. */
      months: { month: string; balance: bigint | null }[];
      /** The first snapshot's day when the history is shorter than six months, else null. */
      startsOn: string | null;
      /** The latest month with a bar. */
      latest: string | null;
    };

const monthOf = (iso: string) => iso.slice(0, 7);

/** The month `offset` months from `month` ("YYYY-MM"). */
export function shiftMonth(month: string, offset: number): string {
  const [year, number] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (number - 1) + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** The first UTC day of the month before the window: the earliest snapshot a carry can start from. */
export function historySince(now: Date): string {
  return `${shiftMonth(monthOf(now.toISOString()), -HISTORY_MONTHS)}-01`;
}

export function balanceHistory(input: {
  snapshots: readonly BalanceSnapshot[];
  flows: readonly PublicFlow[];
  now: Date;
  /** A snapshot older than those given exists, so the history is longer than they show. */
  startedBefore?: boolean;
}): BalanceHistory {
  const snapshots = [...input.snapshots].sort((a, b) => a.at.localeCompare(b.at));
  const first = snapshots[0];
  if (!first) return { kind: "empty" };
  const current = monthOf(input.now.toISOString());
  const windowStart = shiftMonth(current, -(HISTORY_MONTHS - 1));
  const flows = input.flows
    .filter((flow) => flow.at >= first.at)
    .sort((a, b) => a.at.localeCompare(b.at));
  const signed = (flow: PublicFlow) => (flow.type === "deposit" ? flow.amount : -flow.amount);

  // Every month from the first snapshot's to now, so a balance carries across a window's edge.
  const values = new Map<string, bigint | null>();
  let known: bigint | null = null;
  for (let month = monthOf(first.at); month <= current; month = shiftMonth(month, 1)) {
    const last = snapshots.filter((entry) => monthOf(entry.at) === month).at(-1);
    const inMonth = flows.filter((flow) => monthOf(flow.at) === month);
    let value: bigint | null = null;
    if (last) {
      value = inMonth
        .filter((flow) => flow.at > last.at)
        .reduce<bigint>((sum, flow) => sum + signed(flow), last.available + last.pending);
    } else if (inMonth.length > 0 && known !== null) {
      value = inMonth.reduce<bigint>((sum, flow) => sum + signed(flow), known);
    }
    values.set(month, value);
    if (value !== null) known = value;
  }

  const from =
    !input.startedBefore && monthOf(first.at) > windowStart ? monthOf(first.at) : windowStart;
  const months: { month: string; balance: bigint | null }[] = [];
  for (let month = from; month <= current; month = shiftMonth(month, 1)) {
    months.push({ month, balance: values.get(month) ?? null });
  }
  const latest = months.filter((entry) => entry.balance !== null).at(-1)?.month ?? null;
  return {
    kind: "history",
    months,
    startsOn: months.length < HISTORY_MONTHS ? first.day : null,
    latest,
  };
}
