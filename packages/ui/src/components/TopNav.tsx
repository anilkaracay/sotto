import type { ComponentType, ReactNode } from "react";
import { cx } from "./cx.ts";
import styles from "./top-nav.module.css";

export type TopNavItem = {
  key: string;
  label: string;
  href: string;
  active?: boolean;
  badge?: number;
};

type LinkProps = {
  href: string;
  className: string;
  children: ReactNode;
  "aria-current"?: "page";
};

/**
 * Top pill nav (design .vnav). Renders only the items it gets, so a screen that is not built is never
 * linked (ENGINEERING-RULES.md rule 6). `link` lets the app pass its router's link component.
 */
export function TopNav({
  items,
  label = "Main",
  link: Link = "a" as unknown as ComponentType<LinkProps>,
}: {
  items: readonly TopNavItem[];
  label?: string;
  link?: ComponentType<LinkProps>;
}) {
  if (items.length === 0) return null;
  return (
    <nav className={styles.nav} aria-label={label}>
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className={cx(styles.item, item.active && styles.active)}
          {...(item.active ? { "aria-current": "page" as const } : {})}
        >
          {item.label}
          {item.badge ? <span className={styles.badge}>{item.badge}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
