// What every demo page starts with (step 4.6, D-32): whether the demo company exists here. It exists
// only on the devnet configuration with the server's demo file; anywhere else the page says so and
// offers the way to a company of the visitor's own.
import Link from "next/link";
import type { ReactNode } from "react";
import { DEMO_EXIT, type DemoRole } from "../../../lib/demo.ts";
import { serverCluster } from "../../../lib/server/cluster.ts";
import { getDb } from "../../../lib/server/db.ts";
import { demoSummary, loadDemoCompany, type DemoSummary } from "../../../lib/server/demo.ts";
import { DemoShell } from "./demo-shell.tsx";
import styles from "./demo.module.css";

export async function loadDemoSummary(): Promise<DemoSummary | null> {
  const demo = await loadDemoCompany(getDb(), await serverCluster());
  return demo ? demoSummary(demo) : null;
}

export async function DemoPage({
  current,
  children,
}: {
  current: DemoRole | "compare" | "picker";
  children: (summary: DemoSummary) => ReactNode;
}) {
  const summary = await loadDemoSummary();
  if (!summary) {
    return (
      <DemoShell orgName="Northwind Labs" current={current}>
        <header>
          <h1 className={styles.title}>The demo company is not set up here</h1>
          <p className={styles.lead} data-testid="demo-unavailable">
            It runs on Sotto&apos;s devnet deployment only. You can still open a company of your
            own.
          </p>
        </header>
        <p>
          <Link className={styles.verify} href="/app" prefetch={false}>
            {DEMO_EXIT}
          </Link>
        </p>
      </DemoShell>
    );
  }
  return (
    <DemoShell orgName={summary.org.displayName} current={current}>
      {children(summary)}
    </DemoShell>
  );
}
