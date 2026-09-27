import type { ReactNode } from "react";
import styles from "./page-header.module.css";

/** Page header: overline and title, actions on the right (design .vhd). */
export function PageHeader({
  overline,
  title,
  actions,
}: {
  overline?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div>
        {overline ? <small className={styles.overline}>{overline}</small> : null}
        <h1 className={styles.title}>{title}</h1>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
