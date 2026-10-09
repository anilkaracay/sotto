// /demo (step 4.6, D-32): "Explore Northwind as". The four roles of the demo company and the
// comparison of one payment across them. Public, read only, devnet only.
import Link from "next/link";
import { DEMO_ENTRY, DEMO_ROLES, DEMO_ROLE_WORDS, demoRoleTitle } from "../../lib/demo.ts";
import { DemoPage } from "./_components/demo-page.tsx";
import styles from "./_components/demo.module.css";

export const dynamic = "force-dynamic";

export default function DemoPickerPage() {
  return (
    <DemoPage current="picker">
      {(summary) => (
        <>
          <header>
            <small className={styles.overline}>{summary.org.legalName}</small>
            <h1 className={styles.title} data-testid="demo-picker-title">
              {DEMO_ENTRY}
            </h1>
            <p className={styles.lead}>
              One company, the same payments, four readers. Pick a role to see what that person
              reads. The records are real ones on Solana devnet, opened in your browser with that
              role&apos;s demo viewing key. Nothing here can sign, pay or change anything.
            </p>
          </header>
          <div className={styles.picker} data-testid="demo-picker">
            {DEMO_ROLES.map((role) => (
              <Link
                key={role}
                className={styles.pick}
                href={`/demo/${role}`}
                prefetch={false}
                data-testid={`demo-pick-${role}`}
              >
                <small>{DEMO_ROLE_WORDS[role].label}</small>
                <b>{DEMO_ROLE_WORDS[role].person || "Anyone"}</b>
                <p>{DEMO_ROLE_WORDS[role].sees}</p>
                <span>Explore as {demoRoleTitle(role)}</span>
              </Link>
            ))}
            <Link
              className={`${styles.pick} ${styles.wide}`}
              href="/demo/compare"
              prefetch={false}
              data-testid="demo-pick-compare"
            >
              <small>Compare views</small>
              <b>One payment, four readers</b>
              <p>
                The payment to Atlas Freight side by side: what Elif, Daniel, Maya and an outsider
                each see of it, and its transaction on the explorer, which shows no amount.
              </p>
              <span>Compare views</span>
            </Link>
          </div>
        </>
      )}
    </DemoPage>
  );
}
