"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./drawer.module.css";

/** Side drawer (design .drawer): a modal dialog that closes on Escape, the scrim and the close button. */
export function Drawer({
  open,
  title,
  subtitle,
  footer,
  onClose,
  children,
}: {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className={styles.head}>
          <div>
            <h3 id={titleId} className={styles.title}>
              {title}
            </h3>
            {subtitle ? <small className={styles.subtitle}>{subtitle}</small> : null}
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className={styles.body}>{children}</div>
        {footer ? <div className={styles.foot}>{footer}</div> : null}
      </div>
    </>
  );
}
