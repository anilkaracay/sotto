// The frame of every demo screen (step 4.6, D-32): the banner that says what this is ("Demo company on
// devnet · read only"), the four roles to switch between at any time, Compare views, and the way out
// to a company of the visitor's own. A server component: it holds no state and knows no wallet.
import Link from "next/link";
import type { ReactNode } from "react";
import {
  DEMO_BANNER,
  DEMO_EXIT,
  DEMO_ROLES,
  DEMO_ROLE_WORDS,
  demoRoleTitle,
  type DemoRole,
} from "../../../lib/demo.ts";
import { Logo } from "../../app/_components/logo.tsx";
import styles from "./demo.module.css";

export function DemoShell({
  orgName,
  current,
  children,
}: {
  orgName: string;
  /** The screen shown: a role, the comparison, or the picker. */
  current: DemoRole | "compare" | "picker";
  children: ReactNode;
}) {
  return (
    <div className={styles.page}>
      <header className={styles.banner} data-testid="demo-banner">
        <div className={styles.bannerTop}>
          <Link className={styles.logo} href="/" prefetch={false} aria-label="Sotto home">
            <Logo tone="white" decorative />
          </Link>
          <p className={styles.bannerWords}>
            <b>{DEMO_BANNER}</b>
            <span>{orgName}: test money, real records on Solana devnet</span>
          </p>
          <Link className={styles.exit} href="/app" prefetch={false} data-testid="demo-exit">
            {DEMO_EXIT}
          </Link>
        </div>
        <nav className={styles.roles} aria-label="Explore Northwind as">
          <Link
            className={styles.role}
            href="/demo"
            prefetch={false}
            aria-current={current === "picker" ? "page" : undefined}
          >
            All roles
          </Link>
          {DEMO_ROLES.map((role) => (
            <Link
              key={role}
              className={styles.role}
              href={`/demo/${role}`}
              prefetch={false}
              aria-current={current === role ? "page" : undefined}
              title={DEMO_ROLE_WORDS[role].sees}
            >
              {demoRoleTitle(role)}
            </Link>
          ))}
          <Link
            className={styles.role}
            href="/demo/compare"
            prefetch={false}
            aria-current={current === "compare" ? "page" : undefined}
          >
            Compare views
          </Link>
        </nav>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
