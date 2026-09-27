import type { ReactNode } from "react";
import { cx } from "./cx.ts";
import styles from "./toast.module.css";

/** Toast (design .toast), announced politely to screen readers. */
export function Toast({ tone = "ok", children }: { tone?: "ok" | "error"; children: ReactNode }) {
  return (
    <div
      className={cx(styles.toast, tone === "error" && styles.error)}
      role="status"
      aria-live="polite"
    >
      <span className={styles.icon} aria-hidden="true">
        {tone === "ok" ? "✓" : "!"}
      </span>
      {children}
    </div>
  );
}
