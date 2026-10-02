"use client";

// Sign in (F-01, D-15, D-26): every Wallet Standard wallet the browser has, grouped by what it can do
// (lib/wallet-groups.ts), never by name; the user connects, then signs in with an explicit click:
// solana:signIn when the wallet has it, otherwise a signed message. Step 3.4.1 (13 A34; founder,
// 2026-10-01: designed in the repository): the landing's sky with
// what Sotto is in one line and the devnet beta note, beside the sign in panel in the app's language.
import Link from "next/link";
import { signInMethod, walletCapabilities } from "@sotto/sdk/wallet";
import { Button, Chip } from "@sotto/ui";
import { useSignIn, useSignMessage } from "@solana/react";
import { useConnect, useWallets } from "@wallet-standard/react";
import type { UiWallet, UiWalletAccount } from "@wallet-standard/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { completeSignIn, describeWalletError, requestSignIn } from "../../../lib/client/auth.ts";
import { fromWallet } from "../../../lib/client/wallet-words.ts";
import { safeNextPath } from "../../../lib/next-path.ts";
import { shortWallet } from "../../../lib/format.ts";
import {
  GROUP_WORDS,
  missingWords,
  walletGroup,
  type WalletGroup,
} from "../../../lib/wallet-groups.ts";
import { SkyArt } from "./sky-art.tsx";
import styles from "./sign-in.module.css";

type Status = { busy: boolean; error: string | null };

const GROUPS: WalletGroup[] = ["confidential", "sign_in_only", "unsupported"];

export function SignInScreen({ network }: { network: string }) {
  const wallets = useWallets().map((wallet) => ({
    wallet,
    group: walletGroup(walletCapabilities(wallet)),
  }));
  const offered = wallets.filter((entry) => entry.group !== "unsupported").length;
  return (
    <div className={styles.page}>
      <section className={styles.sky} aria-label="About Sotto">
        <SkyArt className={styles.skyArt} />
        <div className={styles.skyInner}>
          <header className={styles.top}>
            <Link className={styles.logo} href="/" prefetch={false} aria-label="Sotto home">
              <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
                <circle cx="13" cy="13" r="11" fill="none" stroke="#FFFFFF" strokeWidth="1.8" />
                <path d="M13 2a11 11 0 000 22z" fill="#FFFFFF" />
              </svg>
              <span>Sotto</span>
            </Link>
            <span className={styles.network} data-testid="network-label">
              {network}
            </span>
          </header>
          <div className={styles.hero}>
            <span className={styles.kicker}>
              <b>Beta</b>Solana devnet
            </span>
            <p className={styles.headline}>Private books. Public chain.</p>
            <p className={styles.oneLine} data-testid="what-sotto-is">
              The business account for companies that pay in stablecoins: every payment settles on
              Solana, and only the people you hand a key to can read the numbers.
            </p>
          </div>
          <div className={styles.beta} data-testid="beta-note">
            <b>A beta on Solana devnet</b>
            <span>
              Balances are devnet test tokens with no value, so nothing here moves real money. Any
              wallet with the capabilities listed here can be used; Sotto was tested with Solflare
              and Phantom.
            </span>
          </div>
        </div>
      </section>

      <main className={styles.panel}>
        <div className={styles.panelInner}>
          <h1 className={styles.title}>Sign in to Sotto</h1>
          <p className={styles.lead}>
            Connect a Solana wallet and sign a message. Signing in never sends a transaction or
            costs a fee.
          </p>
          {offered === 0 ? (
            <p className={styles.empty} role="status" data-testid="no-wallets">
              No Solana wallet that can sign in was found in this browser. Install a wallet that
              supports the Wallet Standard, then reload this page.
            </p>
          ) : null}
          {GROUPS.map((group) => {
            const members = wallets.filter((entry) => entry.group === group);
            if (members.length === 0) return null;
            return (
              <section
                key={group}
                className={styles.group}
                data-testid="wallet-group"
                data-group={group}
              >
                <h2 className={styles.groupTitle}>{GROUP_WORDS[group].title}</h2>
                <p className={styles.groupDetail}>{GROUP_WORDS[group].detail}</p>
                <ul className={styles.list} aria-label={GROUP_WORDS[group].title}>
                  {members.map(({ wallet }, index) =>
                    group === "unsupported" ? (
                      <UnsupportedWallet key={`${index}:${wallet.name}`} wallet={wallet} />
                    ) : (
                      <WalletOption key={`${index}:${wallet.name}`} wallet={wallet} group={group} />
                    ),
                  )}
                </ul>
              </section>
            );
          })}
          <p className={styles.note}>
            Sotto never asks for your recovery phrase and cannot move your funds.{" "}
            <Link href="/trust" prefetch={false}>
              What Sotto can and cannot do
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

/** A wallet D-26 does not offer: its name and what it lacks, without a button. */
function UnsupportedWallet({ wallet }: { wallet: UiWallet }) {
  return (
    <li className={`${styles.wallet} ${styles.unsupported}`} data-testid="wallet-unsupported">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.icon} src={wallet.icon} alt="" />
      <span className={styles.text}>
        <span className={styles.name}>{wallet.name}</span>
        <span className={styles.detail}>{missingWords(walletCapabilities(wallet))}</span>
      </span>
    </li>
  );
}

function WalletOption({ wallet, group }: { wallet: UiWallet; group: WalletGroup }) {
  const [isConnecting, connect] = useConnect(wallet);
  const [account, setAccount] = useState<UiWalletAccount | null>(null);
  const [status, setStatus] = useState<Status>({ busy: false, error: null });
  const method = signInMethod(walletCapabilities(wallet));

  return (
    <li className={styles.wallet} data-testid="wallet-option">
      {/* Wallet icons are data URIs declared by the wallet (Wallet Standard): nothing to optimize. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={styles.icon} src={wallet.icon} alt="" />
      <span className={styles.text}>
        <span className={styles.name}>{wallet.name}</span>
        <span className={styles.detail}>
          {account ? `Connected ${shortWallet(account.address)}` : "Solana wallet"}
        </span>
        <span className={styles.chips}>
          {group === "confidential" ? (
            <Chip tone="green" check>
              Confidential balances
            </Chip>
          ) : (
            <Chip tone="amber">Public payments only</Chip>
          )}
        </span>
        {status.error ? (
          <span className={styles.error} role="alert">
            {status.error}
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
                const accounts = await fromWallet(() => connect());
                setAccount(accounts[0] ?? null);
                if (!accounts[0])
                  setStatus({ busy: false, error: "The wallet shared no account." });
              } catch (error) {
                setStatus({ busy: false, error: describeWalletError(error, wallet.name) });
              }
            }}
          >
            {isConnecting ? "Connecting…" : "Connect"}
          </Button>
        ) : method === "signIn" ? (
          <SignInWithSignIn
            account={account}
            walletName={wallet.name}
            status={status}
            setStatus={setStatus}
          />
        ) : method === "signMessage" ? (
          <SignInWithMessage
            account={account}
            walletName={wallet.name}
            status={status}
            setStatus={setStatus}
          />
        ) : null}
      </span>
    </li>
  );
}

type SignerProps = {
  account: UiWalletAccount;
  /** For the wallet's own words when it refuses (Q-15). */
  walletName: string;
  status: Status;
  setStatus: (status: Status) => void;
};

/**
 * Runs a sign in flow, then opens /app, which the new session cookie now unlocks, or the app page the
 * visitor came from (`?next=`, for example an invite link; step 1.8).
 */
function useSignInRunner(setStatus: (status: Status) => void, walletName: string) {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));
  return async (flow: () => Promise<void>) => {
    setStatus({ busy: true, error: null });
    try {
      await flow();
      router.replace(next);
      router.refresh();
    } catch (error) {
      setStatus({ busy: false, error: describeWalletError(error, walletName) });
    }
  };
}

function SignInWithSignIn({ account, walletName, status, setStatus }: SignerProps) {
  const signIn = useSignIn(account);
  const run = useSignInRunner(setStatus, walletName);
  return (
    <Button
      size="sm"
      disabled={status.busy}
      onClick={() =>
        run(async () => {
          const { input } = await requestSignIn(account.address);
          // The wallet adds its own account address to the message.
          const output = await fromWallet(() =>
            signIn({
              domain: input.domain,
              statement: input.statement,
              uri: input.uri,
              version: input.version,
              nonce: input.nonce,
              issuedAt: input.issuedAt,
              expirationTime: input.expirationTime,
            }),
          );
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

function SignInWithMessage({ account, walletName, status, setStatus }: SignerProps) {
  const signMessage = useSignMessage(account);
  const run = useSignInRunner(setStatus, walletName);
  return (
    <Button
      size="sm"
      disabled={status.busy}
      onClick={() =>
        run(async () => {
          const issued = await requestSignIn(account.address);
          const message = new TextEncoder().encode(issued.message);
          const output = await fromWallet(() => signMessage({ message }));
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
