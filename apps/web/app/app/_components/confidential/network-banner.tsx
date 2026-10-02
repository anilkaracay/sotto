// The startup verification result as a banner (06 section 0, 09 section 4): when a program or the
// wrapped mint is unusable, confidential features are off and the page says why; an unreachable network
// is the shell's banner since step 2.9. A missing wrapped mint is offered for creation on the setup page instead.
import type { AssetWords } from "../../../../lib/asset-words.ts";
import type { NetworkCheck } from "../../../../lib/server/network-view.ts";
import { useAssetWords } from "../asset.tsx";
import styles from "./confidential.module.css";

export function networkProblem(
  check: NetworkCheck,
  label: string,
  asset: AssetWords,
): string | null {
  switch (check.status) {
    case "ok":
    case "wrapped_missing":
      return null;
    case "unreachable":
      // The shell says "Network unreachable, retrying" on every page (D-14, step 2.9).
      return null;
    case "programs_missing":
      return `A Solana program Sotto needs is not available on ${label} (${check.programs.join(", ")}), so confidential features are off.`;
    case "not_configured":
      return `This network has no ${asset.symbol} mint configured, so confidential features are off.`;
    case "wrapped_invalid":
      return `Sotto cannot use the wrapped ${asset.symbol} mint on ${label}: ${check.reason}. Confidential features are off.`;
  }
}

export function NetworkBanner({ check, label }: { check: NetworkCheck; label: string }) {
  const problem = networkProblem(check, label, useAssetWords());
  return problem ? (
    <p className={styles.banner} role="alert" data-testid="network-banner">
      {problem}
    </p>
  ) : null;
}
