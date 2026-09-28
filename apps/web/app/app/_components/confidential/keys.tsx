"use client";

// The wallet, keys and viewing key cards of the confidential pages (F-03, AC-03.2, 10 sections 2 and
// 3, Q-09; built in step 1.5, shared by the setup page, the overview, the recipients page and the
// invite page). The wallet signs on the page; the signatures go to the tab's crypto Web Worker, which
// derives and keeps the keys and answers with public keys only. Nothing is signed before an explicit
// click. Since step 1.8.1 one Unlock click asks for the confidential key signature and then the
// viewing key signature (lib/crypto-worker/unlock.ts).
import { viewKeyMessage, viewKeyRegistrationMessage } from "@sotto/sdk/keys/public";
import { Button, Card, Chip } from "@sotto/ui";
import { useConnect, type UiWallet } from "@wallet-standard/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { ApiCallError, callApi } from "../../../../lib/client/api.ts";
import { isWalletCancel } from "../../../../lib/client/transactions.ts";
import { CryptoWorkerClient } from "../../../../lib/crypto-worker/client.ts";
import type { LockReason } from "../../../../lib/crypto-worker/key-session.ts";
import { unlockKeys, unlockViewingKey } from "../../../../lib/crypto-worker/unlock.ts";
import { formatDate, shortWallet } from "../../../../lib/format.ts";
import { useKeySession } from "../key-session.tsx";
import styles from "./cards.module.css";
import { useConfidential, type SignProblem } from "./context.tsx";

export type ViewerKey = { publicKey: string; createdAt: string };

type Problem = SignProblem | "failed" | "wrong_account" | "register_failed";

const RECOVERY = (
  <Link href="/app/recovery" className={styles.link}>
    Read the recovery guide
  </Link>
);

export function problemText(problem: Problem, detail?: string): ReactNode {
  switch (problem) {
    case "cancelled":
      return "You cancelled the signature in your wallet. Nothing was unlocked.";
    case "refused":
      return (
        <>
          Your wallet refused to sign the key message, so Sotto cannot unlock confidential balances
          with it. Your balances stay onchain, and the standard Solana command line tools can still
          reach them. {RECOVERY}
        </>
      );
    case "message_changed":
      return (
        <>
          Your wallet signed a different message than the one Sotto asked for, so the standard keys
          cannot come from it. {RECOVERY}
        </>
      );
    case "bad_signature":
      return "Your wallet's signature did not verify, so nothing was unlocked.";
    case "failed":
      return "The keys could not be derived in this browser. Reload the page and try again.";
    case "wrong_account":
      return detail ?? "Connect the wallet account you signed in with.";
    case "register_failed":
      return detail ?? "The viewing key could not be registered. Try again.";
  }
}

/** Why the viewing key signature of an Unlock gave no viewing key. */
const VIEWING_PROBLEM: Record<SignProblem | "failed", string> = {
  cancelled: "You cancelled the viewing key signature.",
  refused: "Your wallet refused to sign the viewing key message.",
  message_changed: "Your wallet signed a different message than the viewing key message.",
  bad_signature: "The viewing key signature did not verify.",
  failed: "The viewing key could not be derived in this browser.",
};

/** Why the keys locked on their own; Lock, sign out and reload need no words. */
const LOCK_NOTE: Partial<Record<LockReason, string>> = {
  idle: "The keys locked after 15 minutes without activity.",
  hidden: "The keys locked after 5 minutes in another tab.",
  wallet_change: "The keys locked because your wallet switched accounts.",
  org_switch: "The keys locked because you switched organizations.",
};

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export function WalletCard({ className }: { className?: string }) {
  const { wallet, wallets, connected, network } = useConfidential();
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Card className={className}>
      <h2 className={styles.cardTitle}>Wallet</h2>
      {connected ? (
        <p className={styles.lead} data-testid="keys-wallet">
          Signing with {shortWallet(connected.account.address)}, the wallet you signed in with.
        </p>
      ) : wallets.length === 0 ? (
        <p className={styles.lead} role="status">
          No wallet in this browser can hold confidential balances: it must be able to sign
          messages. Wallets that cannot sign messages, such as some hardware wallets, are not
          supported for owners.
        </p>
      ) : (
        <>
          <p className={styles.lead}>
            Connect the wallet you signed in with ({shortWallet(wallet)}) to sign for your keys.
          </p>
          <ul className={styles.wallets}>
            {wallets.map((w, index) => (
              <ConnectWallet key={`${index}:${w.name}`} wallet={w} onProblem={setProblem} />
            ))}
          </ul>
        </>
      )}
      {connected && !connected.signer ? (
        <p className={styles.problem} role="alert">
          Your wallet does not offer {network.label} for this account, so it cannot sign Sotto
          transactions here.
        </p>
      ) : null}
      {problem ? (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      ) : null}
    </Card>
  );
}

function ConnectWallet({
  wallet,
  onProblem,
}: {
  wallet: UiWallet;
  onProblem: (problem: string | null) => void;
}) {
  const { wallet: expected, setAccount } = useConfidential();
  const [connecting, connect] = useConnect(wallet);
  return (
    <li className={styles.walletRow}>
      {/* Wallet icons are data URIs declared by the wallet (Wallet Standard). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.icon} src={wallet.icon} alt="" />
      <span className={styles.walletName}>{wallet.name}</span>
      <Button
        variant="line"
        size="sm"
        disabled={connecting}
        onClick={async () => {
          onProblem(null);
          try {
            const accounts = await connect();
            const match = accounts.find((a) => a.address === expected);
            if (match) setAccount(match, wallet);
            else
              onProblem(
                `This wallet shared ${accounts[0] ? shortWallet(accounts[0].address) : "no account"}, but you signed in with ${shortWallet(expected)}. Switch to that account in your wallet.`,
              );
          } catch (error) {
            onProblem(
              isWalletCancel(error)
                ? "You cancelled the connection in your wallet."
                : "The wallet could not connect. Try again.",
            );
          }
        }}
      >
        {connecting ? "Connecting…" : "Connect"}
      </Button>
    </li>
  );
}

function Explainer() {
  return (
    <>
      <p className={styles.lead} data-testid="unlock-explainer">
        Unlocking asks your wallet for two signatures, one after the other, so two wallet popups
        follow. The first signs the message <code className="mono">solana-conf-bal/v1</code>: this
        browser tab turns it into the keys that decrypt your confidential balances. The second signs
        Sotto&apos;s viewing key message: it gives your viewing key, which opens the amounts you
        keep sealed and the payment details shared with you. The keys stay in this tab and Sotto
        never receives them. Signing sends no transaction and costs no fee.
      </p>
      <p className={styles.warning} data-testid="unlock-warning">
        Anyone who has this signature can read the confidential balances of this wallet on every
        account, but can never move them. Only sign this in Sotto.
      </p>
    </>
  );
}

export function KeysCard({ className }: { className?: string }) {
  const { wallet, vault, connected } = useConfidential();
  const { session, viewing } = useKeySession();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [viewingProblem, setViewingProblem] = useState<SignProblem | "failed" | null>(null);
  const viewingOpen = viewing?.wallet === wallet;

  async function unlock() {
    if (!connected) return;
    setBusy(true);
    setProblem(null);
    setViewingProblem(null);
    try {
      const outcome = await unlockKeys({ wallet, sign: connected.sign, session });
      if (outcome.keys !== "unlocked") setProblem(outcome.keys);
      else if (outcome.viewing !== "unlocked") setViewingProblem(outcome.viewing);
    } finally {
      setBusy(false);
    }
  }

  /** After a refused viewing key signature: that signature alone, the confidential keys stay. */
  async function unlockViewing() {
    if (!connected) return;
    setBusy(true);
    setViewingProblem(null);
    try {
      const outcome = await unlockViewingKey({ wallet, sign: connected.sign, session });
      if (outcome !== "unlocked") setViewingProblem(outcome);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={className} data-testid="keys-card">
      <div className={styles.head}>
        <h2 className={styles.cardTitle}>Confidential keys</h2>
        <Chip tone={vault.unlocked ? "green" : "amber"} data-testid="keys-status">
          {vault.unlocked ? "Unlocked" : "Locked"}
        </Chip>
      </div>
      {vault.unlocked ? (
        <>
          <dl className={styles.details}>
            <dt>Encryption public key</dt>
            <dd className="mono" data-testid="elgamal-public-key">
              {vault.unlocked.elgamalPubkey}
            </dd>
            <dt>Viewing key</dt>
            <dd data-testid="viewing-unlocked">{viewingOpen ? "Unlocked" : "Not unlocked"}</dd>
          </dl>
          {viewingOpen || busy ? null : (
            <p className={styles.warning} data-testid="viewing-missing">
              {viewingProblem ? `${VIEWING_PROBLEM[viewingProblem]} ` : null}
              Your confidential balances are unlocked, but without the viewing key the amounts you
              keep sealed and the payment details shared with you stay closed in this tab.
            </p>
          )}
          <p className={styles.lead}>
            The keys stay in this tab, across its pages. They lock when you choose Lock, after 15
            minutes without activity, after 5 minutes in another tab, when you reload, sign out or
            switch organizations, and when your wallet switches accounts.
          </p>
          <div className={styles.actions}>
            {viewingOpen || busy ? null : (
              <Button variant="blue" disabled={!connected} onClick={unlockViewing}>
                Sign the viewing key message
              </Button>
            )}
            <Button variant="line" onClick={vault.lock}>
              Lock
            </Button>
          </div>
        </>
      ) : (
        <>
          {vault.lockReason && LOCK_NOTE[vault.lockReason] ? (
            <p className={styles.lead} data-testid="lock-note">
              {LOCK_NOTE[vault.lockReason]}
            </p>
          ) : null}
          <Explainer />
          <div className={styles.actions}>
            <Button variant="blue" disabled={!connected || busy} onClick={unlock}>
              {busy ? "Waiting for your wallet…" : "Unlock with your wallet"}
            </Button>
          </div>
        </>
      )}
      {problem ? (
        <p className={styles.problem} role="alert">
          {problemText(problem)}
        </p>
      ) : null}
    </Card>
  );
}

export function ViewingKeyCard({
  viewerKey,
  className,
}: {
  viewerKey: ViewerKey | null;
  className?: string;
}) {
  const { wallet, connected } = useConfidential();
  const { viewing } = useKeySession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [problem, setProblem] = useState<{ kind: Problem; detail?: string } | null>(null);
  // The viewing key the tab unlocked (Unlock asks for it), whose public key needs no new signature.
  const unlockedKey = viewing?.wallet === wallet ? viewing.publicKey : null;

  async function create() {
    if (!connected) return;
    setBusy(true);
    setProblem(null);
    let worker: CryptoWorkerClient | null = null;
    try {
      let publicKey = unlockedKey;
      if (!publicKey) {
        const derivation = await connected.sign(viewKeyMessage(wallet));
        if (typeof derivation === "string") {
          setProblem({ kind: derivation });
          return;
        }
        // A worker of its own: it derives the viewing key, returns the public key and ends.
        worker = new CryptoWorkerClient();
        ({ publicKey } = await worker.unlockViewing(wallet, derivation));
        worker.terminate();
      }
      if (viewerKey?.publicKey === publicKey) return;
      const registration = await connected.sign(viewKeyRegistrationMessage(fromBase64(publicKey)));
      if (typeof registration === "string") {
        setProblem({ kind: registration });
        return;
      }
      await callApi("/api/viewer-keys", {
        method: "POST",
        body: { publicKey, signature: toBase64(registration) },
      });
      startRefresh(() => router.refresh());
    } catch (error) {
      setProblem({
        kind: "register_failed",
        ...(error instanceof ApiCallError ? { detail: error.message } : {}),
      });
    } finally {
      worker?.terminate();
      setBusy(false);
    }
  }

  return (
    <Card className={className} data-testid="viewing-key-card">
      <div className={styles.head}>
        <h2 className={styles.cardTitle}>Viewing key</h2>
        <Chip tone={viewerKey ? "green" : "neutral"} data-testid="viewing-key-status">
          {viewerKey ? "Registered" : "Not registered"}
        </Chip>
      </div>
      {viewerKey ? (
        <>
          <p className={styles.lead}>
            Registered {formatDate(viewerKey.createdAt)}. Payment details shared with you are
            encrypted to this key, so only this wallet can read them.
          </p>
          <dl className={styles.details}>
            <dt>Public key</dt>
            <dd className="mono" data-testid="viewing-public-key">
              {viewerKey.publicKey}
            </dd>
          </dl>
          {unlockedKey && unlockedKey !== viewerKey.publicKey ? (
            <p className={styles.problem} role="alert" data-testid="viewing-key-mismatch">
              The viewing key unlocked in this tab is not the registered one: your wallet gave a
              different viewing key signature this time, so what is sealed to the registered key
              cannot be opened here.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className={styles.lead}>
            Payment details shared with you are encrypted to your viewing key, so only this wallet
            can read them.{" "}
            {unlockedKey
              ? "Creating it asks your wallet for one signature, which publishes the public key of the viewing key unlocked in this tab."
              : "Creating it asks your wallet for two signatures: one derives the key in this tab, the other publishes its public key."}{" "}
            Sotto stores the public key, never the key itself.
          </p>
          <div className={styles.actions}>
            <Button variant="line" disabled={!connected || busy || refreshing} onClick={create}>
              {busy || refreshing ? "Waiting for your wallet…" : "Create viewing key"}
            </Button>
          </div>
        </>
      )}
      {problem ? (
        <p className={styles.problem} role="alert">
          {problemText(problem.kind, problem.detail)}
        </p>
      ) : null}
    </Card>
  );
}
