import type { HTMLAttributes } from "react";
import styles from "./chip.module.css";
import { cx } from "./cx.ts";

export type ChipTone = "neutral" | "blue" | "green" | "amber" | "red" | "dark";

/** Status chip (design .chip). */
export function Chip({
  tone = "neutral",
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: ChipTone }) {
  return (
    <span className={cx(styles.chip, tone !== "neutral" && styles[tone], className)} {...rest} />
  );
}
