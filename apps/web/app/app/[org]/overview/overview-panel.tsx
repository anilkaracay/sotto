"use client";

// The overview's client part (09 section 3). Step 1.7 built its balance cards (AC-05.1) with the
// wallet and the keys that decrypt the confidential balances in this tab; step 1.10 adds the welcome,
// the confidential account card, the recent activity (activity.tsx) and withdraw (F-09, AC-09.1) as a
// drawer. Every figure comes from chain or from records decrypted in this tab.
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
import { AccountSky } from "./account-sky.tsx";
import { RecentActivity } from "./activity.tsx";
import overview from "./overview.module.css";

export function OverviewPanel({
  wallet,
  userId,
  orgId,
  orgName,
  displayName,
  network,
}: {
  wallet: string;
  userId: string;
  orgId: string;
  orgName: string;
  /** The user's display name from the profile, if set. */
  displayName: string | null;
  network: AvailableNetwork;
}) {
  return (
    <ConfidentialProvider wallet={wallet} orgId={orgId} network={network}>
      <Overview userId={userId} orgName={orgName} displayName={displayName} />
    </ConfidentialProvider>
  );
}

function Overview({
  userId,
  orgName,
  displayName,
}: {
  userId: string;
  orgName: string;
  displayName: string | null;
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
        <BalancesSection />
        <AccountSky orgName={orgName} />
        <div className={overview.side}>
          <WalletCard />
          <KeysCard />
        </div>
        <RecentActivity userId={userId} />
        <Drawer
          open={withdrawing}
          title="Withdraw"
          subtitle={`wUSDC, ${network.wrapLabel}`}
          onClose={close}
        >
          <WithdrawForm />
        </Drawer>
      </div>
    </>
  );
}
