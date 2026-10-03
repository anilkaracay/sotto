// /app/recovery (10 section 2, mitigation 3; D-03): how to reach confidential balances with the
// standard Solana command line tools when a wallet refuses to sign the key message in Sotto, or Sotto is
// not available. Public, no session. The commands were run on localnet with spl-token-cli 5.6.1 and
// solana-keygen 4.2.2 (VERIFICATION-LOG steps 1.5 and 1.6); scripts/recover-balance.ts prints the exact
// amount (founder, 2026-09-27), and scripts/build-token-wrap.sh --cli builds the unwrap tool. Step 4.3
// (D-29): where the devnet registry lists devUSD, the guide names its mints for a devUSD account.
import { getClusterConfig } from "@sotto/sdk/cluster";
import { Card, Chip } from "@sotto/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { currentNetworkLabel } from "../../../lib/network.ts";
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
  const usdc = devnet.available && devnet.usdcMint ? devnet.usdcMint : "<USDC mint>";
  const devusd = devnet.available ? devnet.assets.find((asset) => asset.id === "devusd") : null;
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Logo />
        <Chip tone="blue">{currentNetworkLabel()}</Chip>
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
            confidential balance back to a public balance. A small script from Sotto&apos;s source
            code tells you the exact amount.
          </p>

          <h2 className={styles.heading}>What you need</h2>
          <ul className={styles.list}>
            <li>
              The Solana command line tools: <code className="mono">solana</code>,{" "}
              <code className="mono">solana-keygen</code> and{" "}
              <code className="mono">spl-token</code>.
            </li>
            <li>
              Node.js 24 and pnpm, to run Sotto&apos;s recovery script. It is part of Sotto&apos;s
              source code (github.com/anilkaracay/sotto), which Sotto publishes at its public
              launch.
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

          <h2 className={styles.heading}>5. Find the exact amount</h2>
          <p>In a copy of Sotto&apos;s source code, after pnpm install:</p>
          <Command>{`node scripts/recover-balance.ts --keypair wallet.json --mint ${mint} --url devnet`}</Command>
          <p>
            The script derives your keys on your computer, the same keys Sotto and spl-token derive,
            reads your token account, and prints the available and pending balances with the exact
            command for the next step. It sends nothing: no transaction, and your keys stay on your
            computer. If it still shows a pending balance, repeat step 4 first.
          </p>

          <h2 className={styles.heading}>
            6. Move the confidential balance to your public balance
          </h2>
          <Command>{`spl-token withdraw-confidential-tokens ${mint} <amount>`}</Command>
          <p>
            Use the command the script printed: it has the exact amount, in whole tokens. The
            keyword ALL is not supported for this command in spl-token-cli 5.6.1.
          </p>

          <h2 className={styles.heading}>After recovery</h2>
          <p>
            The tokens are now a public wUSDC balance of your wallet, which any Solana wallet can
            send. During the devnet beta they are test tokens. wUSDC on devnet is wrapped by
            Sotto&apos;s test deployment of Token Wrap, which the standard{" "}
            <code className="mono">spl-token-wrap</code> tool cannot address. To unwrap it to devnet
            USDC, build the tool for that deployment from Sotto&apos;s source code (it needs Rust
            with cargo 1.98.1), create a USDC account if you have none, and unwrap:
          </p>
          <Command>scripts/build-token-wrap.sh --cli</Command>
          <Command>{`spl-token create-account ${usdc}`}</Command>
          <Command>
            {
              ".cache/token-wrap/cli/target/release/spl-token-wrap unwrap <wUSDC token account> <USDC token account> <amount in base units>"
            }
          </Command>
          <p>
            The wUSDC token account is the one the script printed. Unwrap amounts are in base units:
            1 wUSDC is 1000000.
          </p>
          {devusd ? (
            <p data-testid="recovery-devusd">
              An organization that holds devUSD, Sotto&apos;s devnet test dollar with no value, uses
              the same steps with its mints: wrapped devUSD{" "}
              <code className="mono">{devusd.wrappedMint}</code> in place of the wUSDC mint, and
              devUSD <code className="mono">{devusd.baseMint}</code> in place of USDC.
            </p>
          ) : null}
          <p className={styles.back}>
            <Link href="/app">Back to Sotto</Link>
          </p>
        </Card>
      </main>
    </div>
  );
}
