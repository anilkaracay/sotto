"use client";

// The overview's client part (09 section 3). Step 1.7 built its balance cards (AC-05.1) with the
// wallet and the keys that decrypt the confidential balances in this tab; step 1.10 adds the welcome,
// the confidential account card, the recent activity (activity.tsx) and withdraw (F-09, AC-09.1) as a
// drawer; step 2.5 what the chain shows (chain-panel.tsx, AC-05.3); step 2.12 balance growth
// (balance-growth.tsx, AC-05.2). Every figure comes from chain or from records decrypted in this tab.
import { Button, Drawer, PageHeader } from "@sotto/ui";
import Link from "next/link";
import { useCallback, useState } from "react";
import styles from "../../_components/confidential/cards.module.css";
import { BalancesSection } from "../../_components/confidential/balances-section.tsx";
import {
  ConfidentialProvider,
  useConfidential,
  type AvailableNetwork,
} from "../../_components/confidential/context.tsx";
import { KeysCard, WalletCard } from "../../_components/confidential/keys.tsx";
import { NetworkBanner } from "../../_components/confidential/network-banner.tsx";
import { WithdrawForm } from "../../_components/confidential/withdraw.tsx";
import type { OwnerViewerKey } from "../../../../lib/client/balance-snapshot.ts";
import type { RecordedAccount } from "../../_components/confidential/account-cards.tsx";
import { AccountSky } from "./account-sky.tsx";
import { ReadyChecklist } from "../../_components/confidential/ready-checklist.tsx";
import { BalanceGrowth } from "./balance-growth.tsx";
import { RecentActivity } from "./activity.tsx";
import { ChainPanel } from "./chain-panel.tsx";
import overview from "./overview.module.css";

export function OverviewPanel({
  wallet,
  userId,
  orgId,
  orgName,
  displayName,
  network,
  ownerKey,
  recorded,
  hasPayments,
}: {
  wallet: string;
  userId: string;
  orgId: string;
  orgName: string;
  /** The user's display name from the profile, if set. */
  displayName: string | null;
  network: AvailableNetwork;
  /** The owner's registered viewing key, which the daily balance snapshot is sealed to (step 2.12). */
  ownerKey: OwnerViewerKey | null;
  /** The account Sotto has on record for this wallet, for the checklist (steps 4.6, 4.11). */
  recorded: RecordedAccount | null;
  /** The company has made a payment: the dashboard no longer offers the first one (step 4.11). */
  hasPayments: boolean;
}) {
  return (
    <ConfidentialProvider wallet={wallet} orgId={orgId} network={network}>
      <Overview
        userId={userId}
        orgName={orgName}
        displayName={displayName}
        ownerKey={ownerKey}
        recorded={recorded}
        hasPayments={hasPayments}
      />
    </ConfidentialProvider>
  );
}

function Overview({
  userId,
  orgName,
  displayName,
  ownerKey,
  recorded,
  hasPayments,
}: {
  userId: string;
  orgName: string;
  displayName: string | null;
  ownerKey: OwnerViewerKey | null;
  recorded: RecordedAccount | null;
  hasPayments: boolean;
}) {
  const { orgId, network, data } = useConfidential();
  const [withdrawing, setWithdrawing] = useState(false);
  const close = useCallback(() => setWithdrawing(false), []);
  const first = displayName?.trim().split(/\s+/)[0] ?? null;
  const configured = data.wusdc?.status === "present" && data.wusdc.confidential !== null;
  return (
    <>
      <PageHeader
        overline={orgName}
        title={first ? `Welcome back, ${first}` : "Welcome back"}
        actions={
          <div className={overview.actions}>
            <Button
              variant="line"
              disabled={!configured}
              onClick={() => setWithdrawing(true)}
              data-testid="open-withdraw"
            >
              Withdraw
            </Button>
            <Link className={overview.linkButton} href={`/app/${orgId}/payments/new`}>
              New payment
            </Link>
          </div>
        }
      />
      <div className={styles.grid}>
        <NetworkBanner check={network.check} label={network.label} />
        {/* Step 4.11 (D-38): devnet's "Get ready to pay", until the wallet can pay; then the way to
            the first payment, until one was made. */}
        <ReadyChecklist
          recorded={recorded}
          publicViewingKey={ownerKey?.publicKey ?? null}
          variant="dashboard"
          hasPayments={hasPayments}
        />
        <BalancesSection />
        {/* Step 3.7 (M2): the design's first row, the dark balance growth beside a card of a third,
            here the account's sky card. */}
        <div className={overview.duo}>
          <BalanceGrowth userId={userId} ownerKey={ownerKey} />
          <AccountSky orgName={orgName} />
        </div>
        <WalletCard />
        <KeysCard />
        <RecentActivity userId={userId} />
        <ChainPanel />
        <Drawer
          open={withdrawing}
          title="Withdraw"
          subtitle={`${network.asset.wrappedSymbol}, ${network.wrapLabel}`}
          onClose={close}
        >
          <WithdrawForm />
        </Drawer>
      </div>
    </>
  );
}
