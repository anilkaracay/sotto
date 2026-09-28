// A recipient's readiness in words (AC-07.2, AC-07.4): the chip, and why a recipient who is not ready
// cannot be paid confidentially. Presentational only.
import { Chip } from "@sotto/ui";
import { payability, READINESS_LABEL, type Readiness } from "../../../../lib/recipient.ts";
import styles from "./recipients.module.css";

export function ReadinessCell({ readiness }: { readiness: Readiness }) {
  const { payable, reason } = payability(readiness);
  return (
    <div className={styles.readiness} data-testid="recipient-readiness" data-readiness={readiness}>
      <Chip tone={payable ? "green" : "amber"}>{READINESS_LABEL[readiness]}</Chip>
      <small className={styles.reason}>{reason}</small>
    </div>
  );
}
