// The public proof page's view (AC-13.3; step 2.8), a server component, exported for the component
// tests. Proven only for a record that exists, has not expired and was written while the program was
// not paused; every other state says what it is (D-06: Proven or Not proven, never True or False).
// Step 3.4.1 (founder, 2026-10-01: designed in the repository): a certificate. The legal name
// and the statement are the largest words, the result is a stamped band, the slot, time, expiry and
// "Balance disclosed: none" sit in a grid of their own, and every other state is a card as clear.
// Step 4.3: the statement names the record's asset, with the devnet test badge for devUSD.
import Link from "next/link";
import { DevnetTestBadge } from "../../app/_components/devnet-badge.tsx";
import { Logo } from "../../app/_components/logo.tsx";
import { assetWords } from "../../../lib/asset-words.ts";
import { formatDate, shortWallet } from "../../../lib/format.ts";
import { PROVEN, statementWords } from "../../../lib/proofs.ts";
import type { PublicProofView } from "../../../lib/server/proofs.ts";
import styles from "./verify.module.css";

const STATE_WORDS = {
  unavailable: {
    title: "Proofs are not available here",
    detail: "This network has no Sotto proof program.",
  },
  not_found: {
    title: "No proof record",
    detail: "Nothing was ever written at this address. Check the link you were given.",
  },
  closed: {
    title: "This record was closed",
    detail:
      "Its owner closed it after it expired, so it no longer proves anything. Ask them for a new proof.",
  },
  not_a_record: {
    title: "Not a Sotto proof record",
    detail: "The account at this address is not a proof record of the Sotto program.",
  },
} as const;

const STATE_ICON: Record<keyof typeof STATE_WORDS, string> = {
  unavailable: "M4 12h16",
  not_found: "M11 4a7 7 0 100 14 7 7 0 000-14z M20 20l-4-4",
  closed: "M6 11V8a6 6 0 0112 0v3 M5 11h14v10H5z",
  not_a_record: "M6 6l12 12 M18 6L6 18",
};

function dateTime(iso: string): string {
  const date = new Date(iso);
  return `${formatDate(date)}, ${date.toISOString().slice(11, 16)} UTC`;
}

export function VerifyView(props: {
  view: PublicProofView;
  now: Date;
  cluster: "localnet" | "devnet" | null;
}) {
  const { view } = props;
  return (
    <main className={styles.page}>
      <header className={styles.top}>
        <Link className={styles.logo} href="/" prefetch={false} aria-label="Sotto home">
          <Logo tone="white" decorative />
        </Link>
        <span className={styles.network}>
          {props.cluster ? `Solana ${props.cluster}` : "Solana"}
        </span>
      </header>
      {view.state !== "found" ? (
        <section
          className={`${styles.cert} ${styles.void}`}
          data-testid="verify-result"
          data-state={view.state}
        >
          <div className={styles.cth}>
            <span className={styles.kind}>Proof of funds</span>
            {"address" in view ? <span className="mono">{shortWallet(view.address)}</span> : null}
          </div>
          <span className={styles.voidIcon} aria-hidden="true">
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {STATE_ICON[view.state].split(" M").map((part, index) => (
                <path key={index} d={index === 0 ? part : `M${part}`} />
              ))}
            </svg>
          </span>
          <h1 className={styles.voidTitle}>{STATE_WORDS[view.state].title}</h1>
          <p className={styles.voidDetail}>{STATE_WORDS[view.state].detail}</p>
          {"address" in view ? (
            <dl className={styles.addresses}>
              <div>
                <dt>Address</dt>
                <dd className="mono">{view.address}</dd>
              </div>
            </dl>
          ) : null}
        </section>
      ) : (
        <Found view={view} />
      )}
      <p className={styles.foot}>
        Checked on Solana by the Sotto program with the ZK ElGamal Proof program. The balance stays
        encrypted: this page shows only whether it is at least the amount stated.
      </p>
    </main>
  );
}

function Found({ view }: { view: Extract<PublicProofView, { state: "found" }> }) {
  const { record, organization } = view;
  const result =
    view.status === "valid"
      ? {
          word: PROVEN,
          detail: "The statement held when the record was written, and the record is still valid.",
        }
      : view.status === "expired"
        ? {
            word: "Expired",
            detail: `The statement was proven, but the record expired on ${formatDate(record.expiry)}.`,
          }
        : {
            word: "Verification paused",
            detail:
              "The Sotto proof program is paused while an issue is looked into, so this record cannot be relied on right now.",
          };
  const organizationWords =
    organization.status === "not_verified"
      ? "Not verified by Sotto"
      : organization.status === "attestation_expired"
        ? `${organization.legalName}, ${organization.country} (verification expired)`
        : `${organization.legalName}, ${organization.country}`;
  const tone =
    view.status === "valid"
      ? styles.valid
      : view.status === "expired"
        ? styles.expired
        : styles.paused;
  return (
    <section
      className={`${styles.cert} ${tone}`}
      data-testid="verify-result"
      data-state={view.status}
    >
      <div className={styles.cth}>
        <span className={styles.kind}>Proof of funds</span>
        <span className="mono">{shortWallet(record.address)}</span>
      </div>

      <div className={styles.parties}>
        <span className={styles.label}>Organization</span>
        <p
          className={
            organization.status === "verified"
              ? styles.org
              : `${styles.org} ${styles.orgUnverified}`
          }
          data-testid="verify-organization"
        >
          {organizationWords}
        </p>
        {organization.status !== "not_verified" && !organization.reviewed ? (
          <p className={styles.shared} data-testid="verify-organization-note">
            Entered by the organization on devnet. Sotto did not review it.
          </p>
        ) : null}
        <span className={styles.label}>Statement</span>
        <p className={styles.statement} data-testid="verify-statement">
          {statementWords(BigInt(record.threshold), assetWords(record.asset))}
        </p>
        <DevnetTestBadge asset={assetWords(record.asset)} />
        {view.counterpartyLabel ? (
          <p className={styles.shared}>
            Shared with <b>{view.counterpartyLabel}</b>
          </p>
        ) : null}
      </div>

      <div className={styles.band}>
        <span className={styles.stamp} aria-hidden="true">
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {view.status === "expired" ? <circle cx="12" cy="12" r="7.5" /> : null}
            <path
              d={
                view.status === "valid"
                  ? "M5 12l5 5 9-10"
                  : view.status === "expired"
                    ? "M12 8.5V12l2.5 1.5"
                    : "M10 8v8M14 8v8"
              }
            />
          </svg>
        </span>
        <div>
          <b className={styles.word} data-testid="verify-word">
            {result.word}
          </b>
          <small>{result.detail}</small>
        </div>
      </div>

      <dl className={styles.facts}>
        <div>
          <dt>Verified at</dt>
          <dd>
            <b>Slot {record.slot}</b>
            <span>{dateTime(record.writtenAt)}</span>
          </dd>
        </div>
        <div>
          <dt>{view.status === "expired" ? "Expired" : "Valid until"}</dt>
          <dd>
            <b>{formatDate(record.expiry)}</b>
            <span>{new Date(record.expiry).toISOString().slice(11, 16)} UTC</span>
          </dd>
        </div>
        <div className={styles.disclosed}>
          <dt>Balance disclosed</dt>
          <dd>
            <b data-testid="verify-disclosed">none</b>
            <span>The balance stays encrypted</span>
          </dd>
        </div>
      </dl>

      <dl className={styles.addresses}>
        <div>
          <dt>Record</dt>
          <dd className="mono">{record.address}</dd>
        </div>
        <div>
          <dt>Owner wallet</dt>
          <dd className="mono">{record.owner}</dd>
        </div>
      </dl>
    </section>
  );
}
