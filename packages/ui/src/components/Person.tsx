import type { ReactNode } from "react";
import { cx } from "./cx.ts";
import styles from "./person.module.css";

/** Up to two initials: the first letters of the first and the last word. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

/**
 * A person or a business (design .pp): initials in the avatar, the name and a line under it. A
 * business has a rounded square, a person a circle.
 */
export function Person({
  name,
  detail,
  size = 36,
  business = false,
  className,
}: {
  name: string;
  detail?: ReactNode;
  size?: number;
  business?: boolean;
  className?: string;
}) {
  return (
    <span className={cx(styles.person, className)}>
      <span
        className={cx(styles.avatar, business && styles.business)}
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        {initials(name)}
      </span>
      <span className={styles.text}>
        <b>{name}</b>
        {detail ? <small>{detail}</small> : null}
      </span>
    </span>
  );
}
