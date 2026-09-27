import type { HTMLAttributes } from "react";
import styles from "./card.module.css";
import { cx } from "./cx.ts";

/** White card or dark hero card (design .c and .dkc). */
export function Card({
  tone = "light",
  className,
  ...rest
}: HTMLAttributes<HTMLElement> & { tone?: "light" | "dark" }) {
  return (
    <section className={cx(styles.card, tone === "dark" && styles.dark, className)} {...rest} />
  );
}
