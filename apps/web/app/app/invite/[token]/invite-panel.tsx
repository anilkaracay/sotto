"use client";

// The invite page's client part (AC-07.3; step 1.8): the invite before sign in, the check that the
// signed in wallet is the recipient's, the acceptance, and then the recipient's own setup in one
// confidential session: the confidential keys and the viewing key (one Unlock click, step 1.8.1), the
// viewing key's registration (it activates the own_payslips grant) and the wUSDC account, which Sotto
// records so the recipient shows as ready (readiness from chain). Since step 1.8.1 (founder) the page
// shows only the organization before sign in; the recipient's name, role and wallet appear only to the
// invited wallet, and another wallet sees only the refusal with the expected address.
import { Button, Card } from "@sotto/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiCallError, callApi } from "../../../../lib/client/api.ts";
import { formatDate, shortWallet } from "../../../../lib/format.ts";
import type { InviteView } from "../../../../lib/server/invites.ts";
import {
  AccountCard,
  type RecordedAccount,
} from "../../_components/confidential/account-cards.tsx";
import cards from "../../_components/confidential/cards.module.css";
import {
  ConfidentialProvider,
  type AvailableNetwork,
} from "../../_components/confidential/context.tsx";
import {
  KeysCard,
  ViewingKeyCard,
  WalletCard,
  type ViewerKey,
} from "../../_components/confidential/keys.tsx";
import { NetworkBanner } from "../../_components/confidential/network-banner.tsx";
import styles from "./invite.module.css";

export function InvitePanel({
  token,
  invite,
  wallet,
  network,
  viewerKey,
  recorded,
}: {
  token: string;
  invite: InviteView;
  /** The signed in wallet, or null before sign in. */
  wallet: string | null;
  network: AvailableNetwork | null;
  viewerKey: ViewerKey | null;
  recorded: RecordedAccount | null;
}) {
  const org = invite.org.displayName;
  const details = invite.details;

  if (invite.acceptedByYou && wallet && network) {
    return (
      <ConfidentialProvider wallet={wallet} orgId={invite.org.id} network={network}>
        <div className={cards.grid}>
          <NetworkBanner check={network.check} label={network.label} />
          <Card data-testid="invite-joined">
            <h2 className={cards.cardTitle}>You joined {org}</h2>
            <p className={cards.lead}>
              To receive confidential payments from {org}, finish three steps in this tab:
            </p>
            <ol className={styles.steps}>
              <li>Unlock your keys with your wallet: two signatures, one after the other.</li>
              <li>Create your viewing key, so {org} can share your payment details with you.</li>
              <li>Set up your confidential wUSDC account.</li>
            </ol>
            <p className={cards.lead}>
              The payments {org} sends you appear on{" "}
              <Link className={cards.link} href={`/app/${invite.org.id}/pay`}>
                your pay page
              </Link>
              , where you can also withdraw them to USDC.
            </p>
          </Card>
          <WalletCard />
          <KeysCard className={cards.keysCard} />
          <ViewingKeyCard viewerKey={viewerKey} />
          <AccountCard recorded={recorded} />
        </div>
      </ConfidentialProvider>
    );
  }

  return (
    <div className={`${cards.grid} ${cards.single}`}>
      <Card data-testid="invite-card">
        <h2 className={cards.cardTitle}>{org} invites you to receive payments in Sotto</h2>
        <InviteState token={token} invite={invite} wallet={wallet} />
        {details && invite.status === "open" ? (
          <dl className={cards.details} data-testid="invite-details">
            <dt>Recipient</dt>
            <dd>{details.recipient.displayName}</dd>
            {details.recipient.roleTitle ? (
              <>
                <dt>Role</dt>
                <dd>{details.recipient.roleTitle}</dd>
              </>
            ) : null}
            <dt>Wallet</dt>
            <dd className="mono">{details.recipient.wallet}</dd>
            <dt>Link valid until</dt>
            <dd>{formatDate(details.expiresAt)}</dd>
          </dl>
        ) : null}
      </Card>
    </div>
  );
}

function InviteState({
  token,
  invite,
  wallet,
}: {
  token: string;
  invite: InviteView;
  wallet: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const org = invite.org.displayName;

  if (invite.status === "expired") {
    return <p className={cards.lead}>This invite has expired. Ask {org} for a new link.</p>;
  }
  if (invite.status === "unavailable") {
    return <p className={cards.lead}>{org} cannot take new members right now.</p>;
  }
  if (invite.status === "accepted") {
    return <p className={cards.lead}>This invite has already been accepted.</p>;
  }
  if (!wallet) {
    // Before sign in: the organization (the card title) and the sign in button, nothing else.
    return (
      <>
        <div className={cards.actions}>
          <Link
            className={styles.primaryLink}
            href={`/app/sign-in?next=${encodeURIComponent(`/app/invite/${token}`)}`}
            data-testid="invite-sign-in"
          >
            Sign in to accept
          </Link>
        </div>
      </>
    );
  }
  if (invite.expectedWallet) {
    return (
      <p className={cards.problem} role="alert" data-testid="invite-wrong-wallet">
        This invite is for the wallet <span className="mono">{invite.expectedWallet}</span>, and you
        are signed in with {shortWallet(wallet)}. Sign out, then sign in with that wallet.
      </p>
    );
  }
  return (
    <>
      <p className={cards.lead}>
        Accepting adds you to {org} as a recipient and lets {org} pay you in confidential wUSDC:
        amounts are encrypted onchain, so only you, {org} and the people {org} shares them with can
        read them. Then you set up your confidential wUSDC account in this tab.
      </p>
      <div className={cards.actions}>
        <Button
          variant="blue"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setProblem(null);
            try {
              await callApi(`/api/invites/${token}/accept`, { method: "POST" });
              router.refresh();
            } catch (error) {
              setProblem(
                error instanceof ApiCallError ? error.message : "The invite could not be accepted.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Accepting…" : "Accept invite"}
        </Button>
      </div>
      {problem ? (
        <p className={cards.problem} role="alert">
          {problem}
        </p>
      ) : null}
    </>
  );
}
