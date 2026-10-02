// The "Devnet test dollar" badge (step 4.3, founder 2026-10-02): wherever a devnet test asset (devUSD)
// appears, a small badge says so, with the tooltip "A test token for trying Sotto on devnet. It has no
// value." Nothing for any other asset. No hooks, so server pages (/v/) render it too.
import { Chip } from "@sotto/ui";
import {
  DEVNET_TEST_ASSET_BADGE,
  DEVNET_TEST_ASSET_TOOLTIP,
  type AssetWords,
} from "../../../lib/asset-words.ts";

export function DevnetTestBadge({
  asset,
  onDark = false,
}: {
  asset: AssetWords;
  onDark?: boolean;
}) {
  if (!asset.devnetTestAsset) return null;
  return (
    <Chip
      tone="amber"
      onDark={onDark}
      title={DEVNET_TEST_ASSET_TOOLTIP}
      aria-label={`${DEVNET_TEST_ASSET_BADGE}: ${DEVNET_TEST_ASSET_TOOLTIP}`}
      role="note"
      tabIndex={0}
      data-testid="devnet-test-badge"
    >
      {DEVNET_TEST_ASSET_BADGE}
    </Chip>
  );
}
