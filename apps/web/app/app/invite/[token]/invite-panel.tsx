"use client";

// The invite page's client part (AC-07.3; step 1.8): the invite before sign in, the check that the
// signed in wallet is the recipient's, the acceptance, and then the recipient's own setup in one
// confidential session: the viewing key (it activates the own_payslips grant), the confidential keys
// and the wUSDC account, which Sotto records so the recipient shows as ready (readiness from chain).
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
  const recipient = invite.recipient;

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
              <li>Create your viewing key, so {org} can share your payment details with you.</li>
              <li>Unlock your confidential keys with your wallet.</li>
              <li>Set up your confidential wUSDC account.</li>
            </ol>
          </Card>
          <WalletCard />
          <ViewingKeyCard viewerKey={viewerKey} />
          <KeysCard className={cards.keysCard} />
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
        {recipient ? (
          <dl className={cards.details}>
            <dt>Recipient</dt>
            <dd>{recipient.displayName}</dd>
            <dt>Wallet</dt>
            <dd className="mono">{recipient.wallet}</dd>
            <dt>Link valid until</dt>
            <dd>{formatDate(invite.expiresAt)}</dd>
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
  const expected = invite.recipient?.wallet ?? null;

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
    return (
      <>
        <p className={cards.lead}>
          Sign in with the wallet {expected ? shortWallet(expected) : "the invite names"} to accept.
          Accepting lets {org} pay you in confidential wUSDC: amounts stay private onchain, and only
          you and the people you allow can read them.
        </p>
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
  if (expected && wallet !== expected) {
    return (
      <p className={cards.problem} role="alert">
        This invite is for the wallet {shortWallet(expected)}, and you are signed in with{" "}
        {shortWallet(wallet)}. Sign out, then sign in with that wallet.
      </p>
    );
  }
  return (
    <>
      <p className={cards.lead}>
        Accepting adds you to {org} as a recipient and lets {org} share your payment details with
        you. Then you set up your confidential wUSDC account in this tab.
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
