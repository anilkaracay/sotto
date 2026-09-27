import type { TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cx } from "./cx.ts";
import styles from "./table.module.css";

/** Data table (design .tbl). Use <thead> and <tbody> with Th and Td for semantics (09 section 7). */
export function Table({ className, ...rest }: TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cx(styles.table, className)} {...rest} />;
}

export function Th({
  align,
  className,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { align?: "right" }) {
  return <th scope="col" className={cx(align === "right" && styles.right, className)} {...rest} />;
}

export function Td({
  align,
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { align?: "right" }) {
  return <td className={cx(align === "right" && styles.right, className)} {...rest} />;
}
