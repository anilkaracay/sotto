// /trust (step 3.3, built in step 3.4 by the founder's change of 2026-10-01; 13 L6, L7, L36): what
// Sotto can and cannot do with a business's money and numbers, in the landing's language. Public and
// static. Every statement comes from trust-facts.ts, where each names the decision it rests on (D-01,
// D-02, D-05, D-16, facts C3, 10 section 4, ENGINEERING-RULES.md rules 4 and 5); the addresses come from the
// devnet cluster config.
import type { Metadata } from "next";
import Link from "next/link";
import { NEVER_HELD, ONCHAIN, TRUST_CARDS } from "./trust-facts.ts";
import styles from "./trust.module.css";

export const metadata: Metadata = {
  title: "Trust: Sotto",
  description:
    "What Sotto can and cannot do with your money and your numbers, during the beta on Solana devnet.",
};

const ICONS: Record<string, string> = {
  custody: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z M9 12l2 2 4-4",
  sealed: "M6 11V8a6 6 0 0112 0v3 M5 11h14v10H5z",
  access: "M8 15a4 4 0 110-8 4 4 0 010 8z M11 11l9 0 M17 11v3 M20 11v2",
  freeze: "M12 2v20 M4.9 7l14.2 10 M19.1 7L4.9 17",
  devnet: "M4 8h13l-3-3 M20 16H7l3 3",
  program: "M5 4h14v16H5z M9 9h6 M9 13h6 M9 17h3",
};

const Logo = () => (
  <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
    <circle cx="13" cy="13" r="11" fill="none" stroke="#FFFFFF" strokeWidth="1.8" />
    <path d="M13 2a11 11 0 000 22z" fill="#FFFFFF" />
  </svg>
);

function Row({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.row}>
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined}>{value}</dd>
    </div>
  );
}

export default function TrustPage() {
  return (
    <main className="theme-landing">
      <div className={`p5 ${styles.page}`}>
        <section className={styles.sky}>
          <header className="nav5">
            <div className="in">
              <Link className="logo" href="/" aria-label="Sotto home">
                <Logo />
                <span>{"Sotto"}</span>
              </Link>
              <nav className="nl" aria-label="Main">
                <Link href="/#v8views">{"Product"}</Link>
                <Link href="/#v8proof">{"Proofs"}</Link>
                <Link href="/trust" aria-current="page">
                  {"Trust"}
                </Link>
                <Link href="/#v8faq">{"FAQ"}</Link>
              </nav>
              <div className="nr">
                <Link className="si" href="/app">
                  {"Sign in"}
                </Link>
                <Link className="b b-white" href="/#v8access">
                  {"Request access"}
                </Link>
              </div>
            </div>
          </header>
          <div className={`w5 ${styles.heroText}`}>
            <span className="kicker">
              <b>{"Trust"}</b>
              {"Beta on Solana devnet"}
            </span>
            <h1 className={`H2 ${styles.title}`}>
              {"What Sotto can do with your money, and what it cannot."}
            </h1>
            <p className={`lead ${styles.heroLead}`}>
              {
                "Sotto is a beta on Solana devnet. This page says what holds today, and what does not yet."
              }
            </p>
          </div>
        </section>

        <section className={`w5 ${styles.cards}`} aria-label="What holds today">
          {TRUST_CARDS.map((card) => (
            <article key={card.id} className={styles.card} data-testid="trust-card" id={card.id}>
              <span className={styles.icon} aria-hidden="true">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {(ICONS[card.id] ?? "").split(" M").map((part, index) => (
                    <path key={index} d={index === 0 ? part : `M${part}`} />
                  ))}
                </svg>
              </span>
              <h2>{card.title}</h2>
              {card.body.map((text) => (
                <p key={text}>{text}</p>
              ))}
            </article>
          ))}
        </section>

        <section className={`w5 ${styles.split}`}>
          <div className={styles.never} data-testid="never-held">
            <h2>{"What Sotto never holds"}</h2>
            <p>
              {
                "None of these ever reaches Sotto's servers, logs or analytics. They stay in your wallet and in your browser tab."
              }
            </p>
            <ul>
              {NEVER_HELD.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className={styles.note}>
              {
                "Sotto does keep what is public onchain anyway, such as deposit and withdrawal amounts, and the sealed records it cannot open."
              }
            </p>
          </div>
          <div className={styles.facts} data-testid="onchain-facts">
            <h2>{"Onchain, for anyone to check"}</h2>
            <dl>
              <Row label="Network" value={ONCHAIN.network} mono={false} />
              <Row label="Devnet USDC" value={ONCHAIN.usdcMint} />
              <Row label="Token Wrap, test deployment" value={ONCHAIN.tokenWrap} />
              <Row label="Wrapped USDC (wUSDC)" value={ONCHAIN.wrappedMint} />
              <Row label="sotto_proofs program" value={ONCHAIN.proofsProgram} />
              <Row label="sotto_proofs build, SHA-256" value={ONCHAIN.proofsBuildSha256} />
              <Row
                label="Upgrade authority"
                value="A Sotto key, for both programs Sotto deployed, during the beta"
                mono={false}
              />
            </dl>
          </div>
        </section>

        <div className="w5">
          <section className={styles.recovery} data-testid="recovery">
            <div>
              <h2>{"If Sotto disappears"}</h2>
              <p>
                {
                  "Your confidential keys come from your wallet, not from Sotto. With standard Solana tools you can read your confidential balance and withdraw it without Sotto."
                }
              </p>
            </div>
            <Link className="b b-ink" href="/app/recovery">
              {"Read the recovery guide"}
            </Link>
          </section>
        </div>

        <div className="w5">
          <footer className={styles.foot}>
            <span>{"Sotto · Beta on Solana devnet"}</span>
            <nav aria-label="Footer">
              <Link href="/">{"Home"}</Link>
              <Link href="/app/recovery">{"Recovery guide"}</Link>
              <Link href="/app">{"Sign in"}</Link>
            </nav>
          </footer>
        </div>
      </div>
    </main>
  );
}
