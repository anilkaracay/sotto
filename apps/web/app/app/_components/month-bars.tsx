// The design's glowing bar per month on a dark card (step 2.5 Money out, step 2.6 pay history, step
// 2.12 balance growth): each bar's height is its month's share of the chart's top, and the selected
// month is lit with its name and total. A month without a total (null) keeps its label and has no
// bar. With `slots`, fewer months than slots keep the width of a full chart and sit at its right end,
// the latest last. Step 3.7 (M2): the design's y axis (.gy), three round steps from zero to the top,
// which is the smallest round value at or above the highest month, so the bars scale to it. The
// totals come from records opened in the tab; this component only draws them.
import { monthLabel } from "../../../lib/books.ts";
import styles from "./month-bars.module.css";
import { Amount } from "./privacy.tsx";

const BASE = 1_000_000;

/**
 * The axis step: the smallest of 1, 1.5, 2, 2.5, 3, 4, 5, 6 or 8 times a power of ten with which
 * three steps reach `highest`, so the highest bar stands between three fifths and all of the chart.
 */
export function axisStep(highest: number): number {
  if (highest <= 0) return 0;
  const raw = highest / 3;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((value) => fraction <= value) ?? 10;
  return nice * power;
}

/** An axis label in units of 6 decimal places: "0", "2.5", "750", "12k", "1.5M". */
export function axisLabel(units: number): string {
  const trim = (value: number) => String(Number(value.toFixed(2)));
  if (units >= 1_000_000) return `${trim(units / 1_000_000)}M`;
  if (units >= 1_000) return `${trim(units / 1_000)}k`;
  return trim(units);
}

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
  const step = axisStep(Number(highest) / BASE);
  const top = step * 3 * BASE;
  return (
    <div className={`${styles.gbw} ${step > 0 ? styles.withAxis : ""}`}>
      {step > 0 ? (
        <div className={styles.gy} aria-hidden="true">
          {[3, 2, 1, 0].map((index) => (
            <span key={index} style={{ bottom: `${28 + index * 50}px` }}>
              <em>{axisLabel(step * index)}</em>
            </span>
          ))}
        </div>
      ) : null}
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
          const height = top > 0 ? Math.max(3, (Number(total) / top) * 100) : 3;
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
