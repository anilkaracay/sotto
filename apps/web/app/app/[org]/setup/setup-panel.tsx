"use client";

// The setup page's client part (F-03, F-04): the wallet, the keys, the wrapped mint, the confidential
// account, the balances, funding and the viewing key, in one confidential session.
import styles from "../_components/confidential/cards.module.css";
import { BalancesSection } from "../_components/confidential/balances-section.tsx";
import {
  ConfidentialProvider,
  type AvailableNetwork,
} from "../_components/confidential/context.tsx";
import {
  KeysCard,
  ViewingKeyCard,
  WalletCard,
  type ViewerKey,
} from "../_components/confidential/keys.tsx";
import { NetworkBanner } from "../_components/confidential/network-banner.tsx";
import {
  AccountCard,
  FundingCard,
  WrappedMintCard,
  type RecordedAccount,
} from "./account-cards.tsx";

export function SetupPanel({
  wallet,
  orgId,
  network,
  viewerKey,
  recorded,
}: {
  wallet: string;
  orgId: string;
  network: AvailableNetwork;
  viewerKey: ViewerKey | null;
  recorded: RecordedAccount | null;
}) {
  return (
    <ConfidentialProvider wallet={wallet} orgId={orgId} network={network}>
      <div className={styles.grid}>
        <NetworkBanner check={network.check} label={network.label} />
        <WalletCard />
        <KeysCard className={styles.keysCard} />
        <WrappedMintCard />
        <AccountCard recorded={recorded} />
        <BalancesSection />
        <FundingCard recorded={recorded} />
        <ViewingKeyCard viewerKey={viewerKey} className={styles.viewingCard} />
      </div>
    </ConfidentialProvider>
  );
}
