// The design's glowing bar per month on a dark card (step 2.5 Money out, step 2.6 pay history, step
// 2.12 balance growth): each bar's height is its month's share of the highest month, and the selected
// month is lit with its name and total. A month without a total (null) keeps its label and has no
// bar. With `slots`, fewer months than slots keep the width of a full chart and sit at its right end,
// the latest last. The totals come from records opened in the tab; this component only draws them.
import { monthLabel } from "../../../lib/books.ts";
import styles from "./month-bars.module.css";
import { Amount } from "./privacy.tsx";

export function MonthBars({
  totals,
  selected,
  format,
  testId,
  slots,
}: {
  totals: readonly { month: string; total: bigint | null }[];
  selected: string | null;
  format: (total: bigint) => string;
  testId: string;
  /** The columns the chart is laid out for (at least the months given). */
  slots?: number;
}) {
  const columns = Math.max(totals.length, slots ?? 0);
  const offset = columns - totals.length;
  const highest = totals.reduce<bigint>(
    (max, entry) => (entry.total !== null && entry.total > max ? entry.total : max),
    0n,
  );
  return (
    <div className={styles.gbw}>
      <div
        className={styles.gbars}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {totals.map((entry, index) => {
          // The first month starts after the empty slots; the rest follow it.
          const at = index === 0 && offset > 0 ? { gridColumnStart: offset + 1 } : undefined;
          const edge =
            offset + index === 0 ? styles.start : offset + index === columns - 1 ? styles.end : "";
          if (entry.total === null) {
            return (
              <div
                key={entry.month}
                className={styles.gcol}
                style={at}
                data-testid={`${testId}-none`}
              >
                <span className={styles.gm}>{monthLabel(entry.month)}</span>
              </div>
            );
          }
          const total = entry.total;
          const height = highest > 0n ? Math.max(3, Number((total * 1000n) / highest) / 10) : 3;
          const on = entry.month === selected;
          return (
            <div key={entry.month} className={styles.gcol} style={at}>
              <div
                className={`${styles.gb} ${on ? styles.on : ""}`}
                style={{ height: `${height}%`, animationDelay: `${index * 0.07}s` }}
                data-testid={testId}
                data-month={entry.month}
              >
                {on ? (
                  <span className={`${styles.gtag} ${edge}`}>
                    <small>{monthLabel(entry.month, true)}</small>
                    <b className="num">
                      <Amount>{format(total)}</Amount>
                    </b>
                  </span>
                ) : null}
              </div>
              <span className={styles.gm}>{monthLabel(entry.month)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
