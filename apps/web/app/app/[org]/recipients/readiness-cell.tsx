// A recipient's readiness in words (AC-07.2, AC-07.4): the chip, and why a recipient who is not ready
// cannot be paid confidentially, in the organization's asset's words (step 4.3). Presentational only.
import { Chip } from "@sotto/ui";
import type { ReactNode } from "react";
import { payability, READINESS_LABEL, type Readiness } from "../../../../lib/recipient.ts";
import { useAssetWords } from "../../_components/asset.tsx";
import styles from "./recipients.module.css";

export function ReadinessCell({
  readiness,
  children,
}: {
  readiness: Readiness;
  /** Whether the recipient joined, or until when their invite works, next to the chip. */
  children?: ReactNode;
}) {
  const { payable, reason } = payability(readiness, useAssetWords());
  return (
    <div className={styles.readiness} data-testid="recipient-readiness" data-readiness={readiness}>
      <span className={styles.status}>
        <Chip tone={payable ? "green" : "amber"}>{READINESS_LABEL[readiness]}</Chip>
        {children}
      </span>
      <small className={styles.reason}>{reason}</small>
    </div>
  );
}
