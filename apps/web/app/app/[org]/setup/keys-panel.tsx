"use client";

// The keys of the setup page (F-03, AC-03.2, AC-03.5 Locked state, 10 sections 2 and 3, Q-09). The
// wallet signs on this page; the signature goes to the crypto Web Worker, which derives and keeps the
// keys and answers with public keys only. Nothing is signed before an explicit click. Locking (the
// button, 15 minutes idle, 5 minutes hidden, reload or leaving the page) ends the worker.
import {
  checkSignedMessage,
  confidentialKeysMessage,
  viewKeyMessage,
  viewKeyRegistrationMessage,
} from "@sotto/sdk/keys/public";
import { canHoldConfidentialBalances, walletCapabilities } from "@sotto/sdk/wallet";
import { Button, Card, Chip } from "@sotto/ui";
import { useSignMessage } from "@solana/react";
import { useConnect, useWallets } from "@wallet-standard/react";
import type { UiWallet, UiWalletAccount } from "@wallet-standard/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { ApiCallError, callApi } from "../../../../lib/client/api.ts";
import { createAutoLock } from "../../../../lib/crypto-worker/auto-lock.ts";
import { CryptoWorkerClient, CryptoWorkerError } from "../../../../lib/crypto-worker/client.ts";
import { formatDate, shortWallet } from "../../../../lib/format.ts";
import styles from "./setup.module.css";

type ViewerKey = { publicKey: string; createdAt: string };

type Problem =
  | "cancelled"
  | "refused"
  | "message_changed"
  | "bad_signature"
  | "failed"
  | "wrong_account"
  | "register_failed";

const RECOVERY = (
  <Link href="/app/recovery" className={styles.link}>
    Read the recovery guide
  </Link>
);

function problemText(problem: Problem, detail?: string): ReactNode {
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

/** A wallet error that reads as the user saying no, as sign in treats it (lib/client/auth.ts). */
function isCancel(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /reject|denied|cancel|declin/i.test(text);
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export function KeysPanel({ wallet, viewerKey }: { wallet: string; viewerKey: ViewerKey | null }) {
  const wallets = useWallets().filter((w) => canHoldConfidentialBalances(walletCapabilities(w)));
  const [connected, setConnected] = useState<UiWalletAccount | null>(null);
  const authorized = wallets.flatMap((w) => w.accounts).find((a) => a.address === wallet) ?? null;
  const account = connected ?? authorized;
  const [problem, setProblem] = useState<{ kind: Problem; detail?: string } | null>(null);

  return (
    <div className={styles.grid}>
      <Card className={styles.walletCard}>
        <h2 className={styles.cardTitle}>Wallet</h2>
        {account ? (
          <p className={styles.lead} data-testid="keys-wallet">
            Signing with {shortWallet(account.address)}, the wallet you signed in with.
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
                <ConnectWallet
                  key={`${index}:${w.name}`}
                  wallet={w}
                  expected={wallet}
                  onAccount={setConnected}
                  onProblem={setProblem}
                />
              ))}
            </ul>
          </>
        )}
        {problem?.kind === "wrong_account" ? (
          <p className={styles.problem} role="alert">
            {problemText(problem.kind, problem.detail)}
          </p>
        ) : null}
      </Card>
      {account ? (
        <SignedKeys account={account} wallet={wallet} viewerKey={viewerKey} />
      ) : (
        <>
          <LockedCard />
          <ViewingKeyCard wallet={wallet} viewerKey={viewerKey} sign={null} />
        </>
      )}
    </div>
  );
}

function ConnectWallet({
  wallet,
  expected,
  onAccount,
  onProblem,
}: {
  wallet: UiWallet;
  expected: string;
  onAccount: (account: UiWalletAccount) => void;
  onProblem: (problem: { kind: Problem; detail?: string } | null) => void;
}) {
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
            if (match) onAccount(match);
            else
              onProblem({
                kind: "wrong_account",
                detail: `This wallet shared ${accounts[0] ? shortWallet(accounts[0].address) : "no account"}, but you signed in with ${shortWallet(expected)}. Switch to that account in your wallet.`,
              });
          } catch (error) {
            onProblem({
              kind: "wrong_account",
              detail: isCancel(error)
                ? "You cancelled the connection in your wallet."
                : "The wallet could not connect. Try again.",
            });
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
      <p className={styles.lead}>
        Unlocking asks your wallet to sign the message{" "}
        <code className="mono">solana-conf-bal/v1</code>. This browser tab turns the signature into
        the keys that decrypt your confidential balances. The keys stay in this tab and Sotto never
        receives them. Signing sends no transaction and costs no fee.
      </p>
      <p className={styles.warning} data-testid="unlock-warning">
        Anyone who has this signature can read the confidential balances of this wallet on every
        account, but can never move them. Only sign this in Sotto.
      </p>
    </>
  );
}

function LockedCard() {
  return (
    <Card className={styles.keysCard} data-testid="keys-card">
      <div className={styles.head}>
        <h2 className={styles.cardTitle}>Confidential keys</h2>
        <Chip tone="amber" data-testid="keys-status">
          Locked
        </Chip>
      </div>
      <Explainer />
      <div className={styles.actions}>
        <Button variant="blue" disabled>
          Unlock with your wallet
        </Button>
      </div>
    </Card>
  );
}

/** The worker, its auto lock and the unlock state of this page. */
function useVault() {
  const client = useRef<CryptoWorkerClient | null>(null);
  const [unlocked, setUnlocked] = useState<{ elgamalPubkey: string } | null>(null);

  const lock = useCallback(() => {
    client.current?.terminate();
    client.current = null;
    setUnlocked(null);
  }, []);

  useEffect(() => () => client.current?.terminate(), []);

  useEffect(() => {
    if (!unlocked) return;
    const auto = createAutoLock({ onLock: lock });
    const onActivity = () => auto.activity();
    const onVisibility = () => auto.visibility(document.visibilityState === "hidden");
    window.addEventListener("pointerdown", onActivity);
    window.addEventListener("keydown", onActivity);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      auto.stop();
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [unlocked, lock]);

  const worker = useCallback(() => (client.current ??= new CryptoWorkerClient()), []);
  return { worker, unlocked, setUnlocked, lock };
}

function SignedKeys({
  account,
  wallet,
  viewerKey,
}: {
  account: UiWalletAccount;
  wallet: string;
  viewerKey: ViewerKey | null;
}) {
  const signMessage = useSignMessage(account);
  const vault = useVault();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);

  /** Asks the wallet to sign; the signature is usable only for exactly these bytes by this wallet. */
  async function sign(message: Uint8Array): Promise<Uint8Array | Problem> {
    let output: { signedMessage: Uint8Array; signature: Uint8Array };
    try {
      output = await signMessage({ message });
    } catch (error) {
      return isCancel(error) ? "cancelled" : "refused";
    }
    const signature = new Uint8Array(output.signature);
    const check = await checkSignedMessage({
      wallet,
      requested: message,
      signedMessage: new Uint8Array(output.signedMessage),
      signature,
    });
    if (!check.ok) {
      signature.fill(0);
      return check.reason;
    }
    return signature;
  }

  async function unlock() {
    setBusy(true);
    setProblem(null);
    try {
      const signature = await sign(confidentialKeysMessage());
      if (typeof signature === "string") {
        setProblem(signature);
        return;
      }
      vault.setUnlocked(await vault.worker().unlock(wallet, signature));
    } catch (error) {
      setProblem(
        error instanceof CryptoWorkerError && error.code === "bad_signature"
          ? "bad_signature"
          : "failed",
      );
      vault.lock();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card className={styles.keysCard} data-testid="keys-card">
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
            </dl>
            <p className={styles.lead}>
              The keys stay in this tab. They lock when you choose Lock, after 15 minutes without
              activity, after 5 minutes in another tab, and when you reload or leave this page.
            </p>
            <div className={styles.actions}>
              <Button variant="line" onClick={vault.lock}>
                Lock
              </Button>
            </div>
          </>
        ) : (
          <>
            <Explainer />
            <div className={styles.actions}>
              <Button variant="blue" disabled={busy} onClick={unlock}>
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
      <ViewingKeyCard wallet={wallet} viewerKey={viewerKey} sign={sign} />
    </>
  );
}

function ViewingKeyCard({
  wallet,
  viewerKey,
  sign,
}: {
  wallet: string;
  viewerKey: ViewerKey | null;
  /** Null until the wallet is connected. */
  sign: ((message: Uint8Array) => Promise<Uint8Array | Problem>) | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const [problem, setProblem] = useState<{ kind: Problem; detail?: string } | null>(null);

  async function create() {
    if (!sign) return;
    setBusy(true);
    setProblem(null);
    // A worker of its own: it derives the viewing key, returns the public key and ends.
    const worker = new CryptoWorkerClient();
    try {
      const derivation = await sign(viewKeyMessage(wallet));
      if (typeof derivation === "string") {
        setProblem({ kind: derivation });
        return;
      }
      const { publicKey } = await worker.unlockViewing(wallet, derivation);
      worker.terminate();
      if (viewerKey?.publicKey === publicKey) return;
      const registration = await sign(viewKeyRegistrationMessage(fromBase64(publicKey)));
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
      worker.terminate();
      setBusy(false);
    }
  }

  return (
    <Card className={styles.viewingCard} data-testid="viewing-key-card">
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
        </>
      ) : (
        <>
          <p className={styles.lead}>
            Payment details shared with you are encrypted to your viewing key, so only this wallet
            can read them. Creating it asks your wallet for two signatures: one derives the key in
            this tab, the other publishes its public key. Sotto stores the public key, never the key
            itself.
          </p>
          <div className={styles.actions}>
            <Button variant="line" disabled={!sign || busy || refreshing} onClick={create}>
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
