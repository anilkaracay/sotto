"use client";

// The setup page's client part (F-03, F-04): the wallet, the keys, the wrapped mint, the confidential
// account, the balances, funding and the viewing key, in one confidential session. Step 3.5 (13 A36,
// A37): the balances first, then the three steps in the order they are done (unlock the keys, set up
// the account, fund it), numbered, the next one marked, and what the account is made of beside them.
import type { ReactNode } from "react";
import styles from "../../_components/confidential/cards.module.css";
import { BalancesSection } from "../../_components/confidential/balances-section.tsx";
import {
  ConfidentialProvider,
  useConfidential,
  type AvailableNetwork,
} from "../../_components/confidential/context.tsx";
import {
  KeysCard,
  ViewingKeyCard,
  WalletCard,
  type ViewerKey,
} from "../../_components/confidential/keys.tsx";
import { NetworkBanner } from "../../_components/confidential/network-banner.tsx";
import {
  AccountCard,
  FundingCard,
  WrappedMintCard,
  type RecordedAccount,
} from "../../_components/confidential/account-cards.tsx";

/** Which of the three steps comes next: the keys, the account, or funding once both are done. */
export function nextStep(unlocked: boolean, accountKind: string): 1 | 2 | 3 {
  if (!unlocked) return 1;
  return accountKind === "not_set_up" ? 2 : 3;
}

function Step({ no, current, children }: { no: 1 | 2 | 3; current: boolean; children: ReactNode }) {
  return (
    <div
      className={`${styles.step} ${current ? styles.current : ""}`}
      data-step={no}
      data-current={current}
    >
      <span className={styles.stepNo} aria-hidden="true">
        {`0${no}`}
      </span>
      {children}
    </div>
  );
}

function Steps({ recorded }: { recorded: RecordedAccount | null }) {
  const { vault, data } = useConfidential();
  const next = nextStep(vault.unlocked !== null, data.confidential.kind);
  return (
    <div className={styles.column}>
      <Step no={1} current={next === 1}>
        <KeysCard className={styles.keysCard} />
      </Step>
      <Step no={2} current={next === 2}>
        <AccountCard recorded={recorded} />
      </Step>
      <Step no={3} current={next === 3}>
        <FundingCard recorded={recorded} />
      </Step>
    </div>
  );
}

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
      <div className={styles.setup}>
        <NetworkBanner check={network.check} label={network.label} />
        <BalancesSection />
        <Steps recorded={recorded} />
        <div className={styles.column}>
          <WalletCard />
          <ViewingKeyCard viewerKey={viewerKey} className={styles.viewingCard} />
          <WrappedMintCard />
        </div>
      </div>
    </ConfidentialProvider>
  );
}
