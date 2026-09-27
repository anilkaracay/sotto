"use client";

// Sign in (F-01, D-15, D-26): every Wallet Standard wallet that can connect, sign transactions and use
// a Solana chain is offered, with no name list. The user connects, then signs in with an explicit click:
// solana:signIn when the wallet has it, otherwise a signed message.
import { canBeOffered, signInMethod, walletCapabilities } from "@sotto/sdk/wallet";
import { Button, Card, Chip } from "@sotto/ui";
import { useSignIn, useSignMessage } from "@solana/react";
import { useConnect, useWallets } from "@wallet-standard/react";
import type { UiWallet, UiWalletAccount } from "@wallet-standard/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { completeSignIn, describeWalletError, requestSignIn } from "../../../lib/client/auth.ts";
import { safeNextPath } from "../../../lib/next-path.ts";
import { shortWallet } from "../../../lib/format.ts";
import { Logo } from "./logo.tsx";
import styles from "./sign-in.module.css";

type Status = { busy: boolean; error: string | null };

export function SignInScreen({ network }: { network: string }) {
  const wallets = useWallets().filter((wallet) => canBeOffered(walletCapabilities(wallet)));
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Logo />
        <Chip tone="blue" data-testid="network-label">
          {network}
        </Chip>
      </header>
      <div className={styles.center}>
        <Card className={styles.card}>
          <h1 className={styles.title}>Sign in to Sotto</h1>
          <p className={styles.lead}>
            Connect a Solana wallet and sign a message. Signing in never sends a transaction or
            costs a fee.
          </p>
          {wallets.length === 0 ? (
            <p className={styles.empty} role="status">
              No Solana wallet found in this browser. Install a wallet that supports the Wallet
              Standard, then reload this page.
            </p>
          ) : (
            <ul className={styles.list} aria-label="Wallets">
              {wallets.map((wallet, index) => (
                <WalletOption key={`${index}:${wallet.name}`} wallet={wallet} />
              ))}
            </ul>
          )}
          <p className={styles.note}>
            Sotto never asks for your recovery phrase and cannot move your funds.
          </p>
        </Card>
      </div>
    </div>
  );
}

function WalletOption({ wallet }: { wallet: UiWallet }) {
  const [isConnecting, connect] = useConnect(wallet);
  const [account, setAccount] = useState<UiWalletAccount | null>(null);
  const [status, setStatus] = useState<Status>({ busy: false, error: null });
  const method = signInMethod(walletCapabilities(wallet));

  return (
    <li className={styles.wallet} data-testid="wallet-option">
      {/* Wallet icons are data URIs declared by the wallet (Wallet Standard): nothing to optimize. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.icon} src={wallet.icon} alt="" />
      <span>
        <span className={styles.name}>{wallet.name}</span>
        <span className={styles.detail}>
          {account ? `Connected ${shortWallet(account.address)}` : "Solana wallet"}
        </span>
        {status.error ? (
          <span className={styles.error} role="alert">
            {status.error}
          </span>
        ) : null}
        {!method ? (
          <span className={styles.error} role="alert">
            This wallet cannot sign in: it signs neither sign in requests nor messages.
          </span>
        ) : null}
      </span>
      <span className={styles.action}>
        {!account ? (
          <Button
            variant="line"
            size="sm"
            disabled={isConnecting || !method}
            onClick={async () => {
              setStatus({ busy: false, error: null });
              try {
                const accounts = await connect();
                setAccount(accounts[0] ?? null);
                if (!accounts[0])
                  setStatus({ busy: false, error: "The wallet shared no account." });
              } catch (error) {
                setStatus({ busy: false, error: describeWalletError(error) });
              }
            }}
          >
            {isConnecting ? "Connecting…" : "Connect"}
          </Button>
        ) : method === "signIn" ? (
          <SignInWithSignIn account={account} status={status} setStatus={setStatus} />
        ) : method === "signMessage" ? (
          <SignInWithMessage account={account} status={status} setStatus={setStatus} />
        ) : null}
      </span>
    </li>
  );
}

type SignerProps = {
  account: UiWalletAccount;
  status: Status;
  setStatus: (status: Status) => void;
};

/**
 * Runs a sign in flow, then opens /app, which the new session cookie now unlocks, or the app page the
 * visitor came from (`?next=`, for example an invite link; step 1.8).
 */
function useSignInRunner(setStatus: (status: Status) => void) {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));
  return async (flow: () => Promise<void>) => {
    setStatus({ busy: true, error: null });
    try {
      await flow();
      router.replace(next);
      router.refresh();
    } catch (error) {
      setStatus({ busy: false, error: describeWalletError(error) });
    }
  };
}

function SignInWithSignIn({ account, status, setStatus }: SignerProps) {
  const signIn = useSignIn(account);
  const run = useSignInRunner(setStatus);
  return (
    <Button
      size="sm"
      disabled={status.busy}
      onClick={() =>
        run(async () => {
          const { input } = await requestSignIn(account.address);
          // The wallet adds its own account address to the message.
          const output = await signIn({
            domain: input.domain,
            statement: input.statement,
            uri: input.uri,
            version: input.version,
            nonce: input.nonce,
            issuedAt: input.issuedAt,
            expirationTime: input.expirationTime,
          });
          await completeSignIn(
            output.account.address,
            new Uint8Array(output.signedMessage),
            new Uint8Array(output.signature),
          );
        })
      }
    >
      {status.busy ? "Signing in…" : "Sign in"}
    </Button>
  );
}

function SignInWithMessage({ account, status, setStatus }: SignerProps) {
  const signMessage = useSignMessage(account);
  const run = useSignInRunner(setStatus);
  return (
    <Button
      size="sm"
      disabled={status.busy}
      onClick={() =>
        run(async () => {
          const issued = await requestSignIn(account.address);
          const message = new TextEncoder().encode(issued.message);
          const output = await signMessage({ message });
          await completeSignIn(
            account.address,
            new Uint8Array(output.signedMessage),
            new Uint8Array(output.signature),
          );
        })
      }
    >
      {status.busy ? "Signing in…" : "Sign in"}
    </Button>
  );
}
