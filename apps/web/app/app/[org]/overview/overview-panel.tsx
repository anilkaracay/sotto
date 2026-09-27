"use client";

// The overview's client part in step 1.7 (AC-05.1): the balance cards, with the wallet and the keys
// that decrypt the confidential balances in this tab. The rest of the overview comes in step 1.10.
import styles from "../../_components/confidential/cards.module.css";
import { BalancesSection } from "../../_components/confidential/balances-section.tsx";
import {
  ConfidentialProvider,
  type AvailableNetwork,
} from "../../_components/confidential/context.tsx";
import { KeysCard, WalletCard } from "../../_components/confidential/keys.tsx";
import { NetworkBanner } from "../../_components/confidential/network-banner.tsx";

export function OverviewPanel({
  wallet,
  orgId,
  network,
}: {
  wallet: string;
  orgId: string;
  network: AvailableNetwork;
}) {
  return (
    <ConfidentialProvider wallet={wallet} orgId={orgId} network={network}>
      <div className={styles.grid}>
        <NetworkBanner check={network.check} label={network.label} />
        <BalancesSection />
        <WalletCard />
        <KeysCard className={styles.keysCard} />
      </div>
    </ConfidentialProvider>
  );
}
