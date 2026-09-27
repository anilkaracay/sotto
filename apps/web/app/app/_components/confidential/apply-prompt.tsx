// The apply prompt (AC-04.3): when the worker flagged the account (its pending balance credit counter
// at or above 80 percent of the maximum), or the counter read from chain is there, the page prompts
// the owner to apply the pending balance on the next unlock. Nothing is applied without the owner.
import { APPLY_FLAG_PERCENT } from "@sotto/sdk/confidential/public";
import type { ReactNode } from "react";
import styles from "./cards.module.css";

export function applyPromptNeeded(input: {
  flagged: boolean;
  credits: bigint;
  maximumCredits: bigint;
}): boolean {
  if (input.credits <= 0n) return false;
  if (input.flagged) return true;
  return (
    input.maximumCredits > 0n && input.credits * 100n >= input.maximumCredits * APPLY_FLAG_PERCENT
  );
}

export function ApplyPromptNotice({
  credits,
  maximumCredits,
  action,
}: {
  credits: bigint;
  maximumCredits: bigint;
  action: ReactNode;
}) {
  return (
    <div className={styles.warning} role="status" data-testid="apply-prompt">
      <p>
        Your account has received {credits.toString()} deposits or payments since the pending
        balance was last applied, and it can hold {maximumCredits.toString()} before it must be
        applied. Apply the pending balance so the account can keep receiving.
      </p>
      <div className={styles.actions}>{action}</div>
    </div>
  );
}
