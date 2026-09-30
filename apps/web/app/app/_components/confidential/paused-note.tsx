"use client";

// F-19 (AC-19.1; step 2.9): the words next to a confidential action that is disabled while the ZK
// ElGamal Proof program is unavailable. Nothing when confidential actions are not paused.
import { useConfidential } from "./context.tsx";
import styles from "./confidential.module.css";

export function PausedNote() {
  const { blocked } = useConfidential();
  return blocked ? (
    <p className={styles.paused} role="status" data-testid="action-paused">
      {blocked}
    </p>
  ) : null;
}
