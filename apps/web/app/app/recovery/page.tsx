// /app/recovery (10 section 2, mitigation 3; D-03): how to reach confidential balances with the
// standard Solana command line tools when a wallet refuses to sign the key message in Sotto, or Sotto is
// not available. Public, no session. Every command below was run for this guide on localnet with
// spl-token-cli 5.6.1 and solana-keygen 4.2.2 (VERIFICATION-LOG step 1.5).
import { getClusterConfig } from "@sotto/sdk/cluster";
import { Card, Chip } from "@sotto/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { networkLabel } from "../../../lib/network.ts";
import { Logo } from "../_components/logo.tsx";
import styles from "./recovery.module.css";

export const metadata: Metadata = { title: "Recovery guide · Sotto" };

function Command({ children }: { children: string }) {
  return (
    <pre className={styles.command}>
      <code className="mono">{children}</code>
    </pre>
  );
}

export default function RecoveryPage() {
  const devnet = getClusterConfig("devnet");
  const mint = devnet.available && devnet.wrappedUsdcMint ? devnet.wrappedUsdcMint : "<wUSDC mint>";
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Logo />
        <Chip tone="blue">{networkLabel(process.env.NEXT_PUBLIC_CLUSTER)}</Chip>
      </header>
      <main className={styles.body}>
        <Card className={styles.card}>
          <h1 className={styles.title}>Reach your confidential balances without Sotto</h1>
          <p className={styles.lead}>
            Sotto derives your confidential keys the standard way: your wallet signs the message{" "}
            <code className="mono">solana-conf-bal/v1</code> and the keys come from that signature.
            The Solana command line tool <code className="mono">spl-token</code> derives the same
            keys from the same wallet. We checked this with spl-token-cli 5.6.1: it configures the
            same encryption key, and our key decrypts the balance it records. So if your wallet
            stops signing that message in Sotto, or Sotto is not available, you can still move your
            confidential balance back to a public balance.
          </p>

          <h2 className={styles.heading}>What you need</h2>
          <ul className={styles.list}>
            <li>
              The Solana command line tools: <code className="mono">solana</code>,{" "}
              <code className="mono">solana-keygen</code> and{" "}
              <code className="mono">spl-token</code>.
            </li>
            <li>
              Your wallet&apos;s recovery phrase, or its private key exported from the wallet.
            </li>
            <li>A little SOL in the wallet for transaction fees.</li>
          </ul>
          <p className={styles.note}>
            Do this on your own computer. Never type your recovery phrase or private key into a
            website, and never share them. Sotto will never ask for them.
          </p>

          <h2 className={styles.heading}>1. Create a keypair file for your wallet</h2>
          <p>From the recovery phrase, which the tool asks you to type:</p>
          <Command>{"solana-keygen recover 'prompt://?key=0/0' --outfile wallet.json"}</Command>
          <p>
            This recovers the account at the derivation path m/44&apos;/501&apos;/0&apos;/0&apos;.
            If you exported the private key from your wallet instead, pass it in place of{" "}
            <code className="mono">&apos;prompt://?key=0/0&apos;</code>; it then stays in your shell
            history, so clear the history afterwards.
          </p>

          <h2 className={styles.heading}>2. Check that it is your wallet</h2>
          <Command>solana-keygen pubkey wallet.json</Command>
          <p>
            This must print your wallet address. If it prints another address, stop: the file is a
            different account of your recovery phrase, and you can export the account&apos;s private
            key from your wallet instead.
          </p>

          <h2 className={styles.heading}>3. Point the tools at your wallet and the network</h2>
          <Command>solana config set --keypair wallet.json --url devnet</Command>

          <h2 className={styles.heading}>4. Move pending tokens into your available balance</h2>
          <Command>{`spl-token apply-pending-balance ${mint}`}</Command>

          <h2 className={styles.heading}>
            5. Move the confidential balance to your public balance
          </h2>
          <Command>{`spl-token withdraw-confidential-tokens ${mint} <amount>`}</Command>
          <p>
            The amount is in whole tokens, for example <code className="mono">40</code> for 40
            wUSDC. The keyword ALL is not supported for this command. An amount above your available
            balance fails with InsufficientFunds and costs nothing, so you can try lower amounts
            until one succeeds.
          </p>

          <h2 className={styles.heading}>After recovery</h2>
          <p>
            The tokens are now a public wUSDC balance of your wallet, which any Solana wallet can
            send. During the devnet beta they are test tokens: wUSDC is wrapped by Sotto&apos;s test
            deployment of Token Wrap on devnet, which the standard{" "}
            <code className="mono">spl-token-wrap</code> tool cannot address, so unwrapping it to
            devnet USDC needs a Token Wrap tool built for that deployment.
          </p>
          <p className={styles.back}>
            <Link href="/app">Back to Sotto</Link>
          </p>
        </Card>
      </main>
    </div>
  );
}
