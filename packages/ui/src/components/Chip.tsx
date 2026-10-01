import type { HTMLAttributes } from "react";
import styles from "./chip.module.css";
import { cx } from "./cx.ts";

export type ChipTone = "neutral" | "blue" | "green" | "amber" | "red" | "dark";

/**
 * Status chip (design .chip); `check` puts the design's check before a done state's words, and
 * `onDark` gives the tones of the design's dark cards (.dkc .chip).
 */
export function Chip({
  tone = "neutral",
  check = false,
  onDark = false,
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: ChipTone; check?: boolean; onDark?: boolean }) {
  return (
    <span
      className={cx(
        styles.chip,
        tone !== "neutral" && styles[tone],
        onDark && styles.onDark,
        className,
      )}
      {...rest}
    >
      {check ? (
        <svg
          className={styles.check}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      ) : null}
      {children}
    </span>
  );
}
