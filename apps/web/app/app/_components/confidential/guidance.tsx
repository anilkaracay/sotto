// Step 4.11 (D-38): a blocked action in three parts, wherever it is blocked: what happened, why, and
// a button that fixes it right there. The fix runs in place, so the form around it keeps its values.
import type { ReactNode } from "react";
import { WALKTHROUGH_WALLETS } from "../../../../lib/walkthrough.ts";
import styles from "./ready.module.css";

export function Guidance(props: {
  /** For tests and for the rehearsal: which block this is. */
  id: string;
  what: ReactNode;
  why: ReactNode;
  /** The fix: one button, and what goes with it. */
  children?: ReactNode;
}) {
  return (
    <div className={styles.guidance} role="alert" data-testid={`guidance-${props.id}`}>
      <p>
        <b>{props.what}</b>
      </p>
      <div>{props.why}</div>
      {props.children ? <div className={styles.guidanceActions}>{props.children}</div> : null}
    </div>
  );
}

/**
 * After a signature the wallet rejected or could not make: the app cannot see which network the
 * wallet is on, so it asks, with the way to devnet in each wallet (the walkthrough's own words).
 */
export function DevnetSteps() {
  const { phantom, solflare } = WALKTHROUGH_WALLETS;
  return (
    <ul data-testid="devnet-steps">
      <li>
        Phantom: the account menu at the top left, the gear, {phantom.settings}, turn on{" "}
        {phantom.toggle}; {phantom.network} is selected.
      </li>
      <li>
        Solflare: the gear, {solflare.section}, {solflare.setting}, choose {solflare.network}, then{" "}
        {solflare.confirm}.
      </li>
    </ul>
  );
}
