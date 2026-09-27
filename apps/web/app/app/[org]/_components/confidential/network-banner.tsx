// The startup verification result as a banner (06 section 0, 09 section 4): when a program or the
// wrapped mint is unusable, or the network cannot be reached, confidential features are off and the
// page says why. A missing wrapped mint is offered for creation on the setup page instead.
import type { NetworkCheck } from "../../../../../lib/server/network-view.ts";
import styles from "./confidential.module.css";

export function networkProblem(check: NetworkCheck, label: string): string | null {
  switch (check.status) {
    case "ok":
    case "wrapped_missing":
      return null;
    case "unreachable":
      return `Sotto cannot reach the ${label} network right now, so balances and account actions are unavailable. Your keys still work. Reload the page to try again.`;
    case "programs_missing":
      return `A Solana program Sotto needs is not available on ${label} (${check.programs.join(", ")}), so confidential features are off.`;
    case "not_configured":
      return `This network has no USDC mint configured, so confidential features are off.`;
    case "wrapped_invalid":
      return `Sotto cannot use the wrapped USDC mint on ${label}: ${check.reason}. Confidential features are off.`;
  }
}

export function NetworkBanner({ check, label }: { check: NetworkCheck; label: string }) {
  const problem = networkProblem(check, label);
  return problem ? (
    <p className={styles.banner} role="alert" data-testid="network-banner">
      {problem}
    </p>
  ) : null;
}
