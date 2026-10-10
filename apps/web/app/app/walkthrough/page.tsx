// /app/walkthrough (step 4.8, D-35; the flow of step 4.11, D-38): from a wallet on devnet to a first confidential payment, its
// check on the explorer and a proof of funds, one picture per step, in the words the live screens
// show (lib/walkthrough.ts; apps/web/test/walkthrough.test.tsx keeps them equal to the screens').
// Public, no session. The pictures were taken on https://sottoapp.xyz with a new devnet wallet; the
// wallets' own screens are Phantom's and Solflare's, at the versions the page names.
import { Card, Chip } from "@sotto/ui";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { DEMO_RECIPIENT } from "../../../lib/demo.ts";
import { currentNetworkLabel } from "../../../lib/network.ts";
import { LANDING_TITLE } from "../../../lib/site-metadata.ts";
import {
  WALKTHROUGH_LABELS as L,
  WALKTHROUGH_PAY,
  WALKTHROUGH_PROOF,
  WALKTHROUGH_STEPS,
  WALKTHROUGH_TITLE,
  WALKTHROUGH_WALLETS as W,
} from "../../../lib/walkthrough.ts";
import { Logo } from "../_components/logo.tsx";
import styles from "./walkthrough.module.css";

export const metadata: Metadata = { title: LANDING_TITLE };

/** A control's label, as the screen shows it. */
function B({ children }: { children: ReactNode }) {
  return <b className={styles.label}>{children}</b>;
}

function Shot(props: {
  name: string;
  width: number;
  height: number;
  alt: string;
  narrow?: boolean;
}) {
  return (
    <figure className={props.narrow ? `${styles.shot} ${styles.narrow}` : styles.shot}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/walkthrough/${props.name}.webp`}
        width={props.width}
        height={props.height}
        alt={props.alt}
        loading="lazy"
        decoding="async"
      />
    </figure>
  );
}

function Step(props: { index: number; children: ReactNode }) {
  return (
    <section className={styles.step} data-testid="walkthrough-step">
      <h2 className={styles.heading}>
        <span className={styles.no} aria-hidden="true">
          {String(props.index + 1).padStart(2, "0")}
        </span>
        {WALKTHROUGH_STEPS[props.index]}
      </h2>
      {props.children}
    </section>
  );
}

export default function WalkthroughPage() {
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Link href="/" prefetch={false} aria-label="Sotto home">
          <Logo decorative />
        </Link>
        <Chip tone="blue">{currentNetworkLabel()}</Chip>
      </header>
      <main className={styles.body}>
        <Card className={styles.card}>
          <h1 className={styles.title}>{WALKTHROUGH_TITLE}</h1>
          <p className={styles.lead}>
            Six steps on Solana devnet with test money that has no value. You need Phantom or
            Solflare in your browser and nothing else: Sotto sends the test SOL and the test
            dollars. With no wallet at all,{" "}
            <Link href="/demo" prefetch={false}>
              {L.demoEntry.label.toLowerCase()}
            </Link>{" "}
            instead.
          </p>

          <Step index={0}>
            <p>
              Sotto runs on devnet, so the wallet has to be on devnet too. A new, empty account is
              enough.
            </p>
            <ul className={styles.list}>
              <li>
                Phantom (checked with {W.phantom.version}): open the account menu at the top left,
                then the gear, then <B>{W.phantom.settings}</B>, and turn on{" "}
                <B>{W.phantom.toggle}</B>. Phantom goes back to its home screen and shows{" "}
                <B>{W.phantom.banner}</B>. <B>{W.phantom.network}</B> is selected already: it is
                ticked under {W.phantom.settings}, as in the picture.
              </li>
              <li>
                Solflare (checked with {W.solflare.version}): open the gear, then{" "}
                <B>{W.solflare.section}</B>. Under <B>{W.solflare.setting}</B> choose{" "}
                <B>{W.solflare.network}</B>, and in the dialog <B>{W.solflare.dialog}</B> choose{" "}
                <B>{W.solflare.confirm}</B>.
              </li>
            </ul>
            <div className={styles.pair}>
              <Shot
                name="phantom-devnet"
                width={390}
                height={640}
                narrow
                alt="Phantom's Developer Settings with Testnet Mode on and Solana Devnet ticked"
              />
              <Shot
                name="solflare-devnet"
                width={1200}
                height={900}
                alt="Solflare's settings, General: the Network list open with Mainnet, Testnet and Devnet"
              />
            </div>
          </Step>

          <Step index={1}>
            <p>
              Open <Link href="/app">sottoapp.xyz/app</Link>, or choose <B>{L.quickStart.label}</B>{" "}
              on the home page. Next to your wallet choose <B>{L.connect.label}</B> and approve the
              connection, then <B>{L.signIn.label}</B> and approve the message. Signing in sends no
              transaction and costs nothing.
            </p>
            <p>
              There is no form. Your company, named My company, is there at once and you land on its
              dashboard. You can change its name and details later.
            </p>
            <Shot
              name="sign-in"
              width={1440}
              height={900}
              alt="The sign in screen: the two entries, Explore the demo company and Quick start, above the wallet list with its Connect button"
            />
          </Step>

          <Step index={2}>
            <p>
              The dashboard opens with the checklist <B>{L.ready.label}</B>. It has six steps, one
              in turn at a time, each with one button and a line that says what your wallet will ask
              before it opens. Nothing is signed until you choose a step&apos;s button.
            </p>
            <ol className={styles.list}>
              <li>
                <B>{L.getSol.label}</B>: Sotto sends your wallet 0.05 SOL for fees. No wallet
                window.
              </li>
              <li>
                <B>{L.setUp.label}</B>: your wallet opens four windows, three messages that make and
                check your keys in this browser tab and one transaction that sets your confidential
                account up.
              </li>
              <li>
                <B>{L.registerKey.label}</B>: one message. Payment records are sealed to this key,
                so you can read your own records and nobody else can.
              </li>
              <li>
                <B>{L.getDevusd.label}</B>: Sotto mints test dollars to your wallet. No wallet
                window.
              </li>
              <li>
                <B>{L.move.label}</B>: one transaction that wraps the devUSD and deposits it into
                your confidential balance. You can change the amount first; it is public onchain,
                the balance it joins is not.
              </li>
              <li>
                <B>{L.apply.label}</B>: one transaction that makes the deposit available to spend.
              </li>
            </ol>
            <p>
              Each finished step that happened onchain has its <B>{L.verify.label}</B> link
              (registering the viewing key is a signed message, not a transaction). The same
              checklist is pinned at the top of Payments, Payroll and Proofs until it is complete.
              Then the dashboard says <B>{L.readyDone.label}</B>, with the button{" "}
              <B>{L.payAtlas.label}</B>.
            </p>
            <Shot
              name="ready-start"
              width={1360}
              height={775}
              alt="The checklist Get ready to pay on the dashboard: six steps, the first in turn with the button Get test SOL"
            />
            <Shot
              name="ready-account"
              width={1360}
              height={947}
              alt="The checklist with test SOL done and the account step in turn: what the wallet will ask, and the button Unlock my keys and set up the account"
            />
            <Shot
              name="ready-done"
              width={1360}
              height={147}
              alt="The dashboard once the checklist is complete: Ready. Make your first confidential payment, with the button Pay Atlas Freight"
            />
          </Step>

          <Step index={3}>
            <p>
              <B>{L.payAtlas.label}</B> opens <B>{L.payments.label}</B> with the card{" "}
              <B>{L.payCard.label}</B> and, under <B>{L.recipient.label}</B>,{" "}
              <B>{DEMO_RECIPIENT.displayName}</B> chosen already: a company made by quick start has
              this demo recipient from the start, a demo wallet whose account can receive
              confidential payments. Type an amount under <B>{L.payAmount.label}</B>, for example{" "}
              {WALKTHROUGH_PAY}, a <B>{L.memo.label}</B> if you like, and choose{" "}
              <B>{L.pay.label}</B>. Solflare then asks for {W.solflare.payment}; Phantom asks for{" "}
              {W.phantom.payment}, as it signs the payment as five smaller transactions.
            </p>
            <p>
              If something stops the payment, the card says what happened and why, with a button
              that fixes it in place: too little in the confidential balance, too little SOL, a
              signature your wallet refused. Your form keeps what you typed.
            </p>
            <Shot
              name="pay"
              width={560}
              height={509}
              narrow
              alt="The card Pay a recipient: Atlas Freight (demo recipient) chosen, 1250.50 under Amount (devUSD), a memo, and the button Pay"
            />
          </Step>

          <Step index={4}>
            <p>
              Under <B>{L.recentPayments.label}</B>, the column <B>{L.transactionColumn.label}</B>{" "}
              holds the payment&apos;s link to the Solana explorer. Open it. The explorer shows the
              instruction Token-2022 Program: Confidential Transfer with its source, destination and
              mint, and no amount: the number you typed is on this page of Sotto and nowhere on the
              explorer.
            </p>
            <Shot
              name="explorer"
              width={976}
              height={640}
              alt="The Solana explorer's view of the payment: the instruction Token-2022 Program: Confidential Transfer with accounts and proof accounts, and no amount"
            />
          </Step>

          <Step index={5}>
            <p>
              Open <B>{L.proofs.label}</B>. In the card <B>{L.newProof.label}</B>, under{" "}
              <B>{L.atLeast.label}</B> choose <B>{L.custom.label}</B> and type an amount your
              balance covers, for example {WALKTHROUGH_PROOF}. Under <B>{L.shareWith.label}</B> type
              who the answer is for, then choose <B>{L.generateProof.label}</B>. Your wallet asks
              for five transactions. The result says Proven, and <B>{L.openPublicPage.label}</B>{" "}
              opens a page anyone can read without a wallet: it states that the balance is at least
              the amount, and discloses no balance.
            </p>
            <Shot
              name="proof"
              width={787}
              height={555}
              alt="The proof's certificate: Proven, balance is at least 50,000 devUSD, with the link Open the public page"
            />
            <Shot
              name="proof-public"
              width={1280}
              height={860}
              alt="The proof's public page: My company, balance is at least 50,000 devUSD, Proven, balance disclosed none"
            />
          </Step>

          <p className={styles.back}>
            <Link href="/app">Open Sotto</Link> · <Link href="/demo">{L.demoEntry.label}</Link>
          </p>
        </Card>
      </main>
    </div>
  );
}
