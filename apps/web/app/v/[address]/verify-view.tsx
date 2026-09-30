// The public proof page's view (AC-13.3; step 2.8), a server component, exported for the component
// tests. Proven only for a record that exists, has not expired and was written while the program was
// not paused; every other state says what it is (D-06: Proven or Not proven, never True or False).
import { formatDate, shortWallet } from "../../../lib/format.ts";
import { PROVEN, statementWords } from "../../../lib/proofs.ts";
import type { PublicProofView } from "../../../lib/server/proofs.ts";
import { Logo } from "../../app/_components/logo.tsx";
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
        <Logo />
        <span className={styles.network}>
          {props.cluster ? `Solana ${props.cluster}` : "Solana"}
        </span>
      </header>
      {view.state !== "found" ? (
        <section className={styles.cert} data-testid="verify-result" data-state={view.state}>
          <div className={styles.cth}>
            <span>Proof of funds</span>
            {"address" in view ? <span className="mono">{shortWallet(view.address)}</span> : null}
          </div>
          <h1 className={styles.title}>{STATE_WORDS[view.state].title}</h1>
          <p className={styles.detail}>{STATE_WORDS[view.state].detail}</p>
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
  return (
    <section className={styles.cert} data-testid="verify-result" data-state={view.status}>
      <div className={styles.cth}>
        <span>Proof of funds</span>
        <span className="mono">{shortWallet(record.address)}</span>
      </div>
      <div className={styles.cres}>
        <span
          className={view.status === "valid" ? `${styles.stamp} ${styles.yes}` : styles.stamp}
          aria-hidden="true"
        >
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="2.4"
          >
            <path d={view.status === "valid" ? "M5 12l5 5 9-10" : "M12 7v6M12 17h.01"} />
          </svg>
        </span>
        <div>
          <b
            className={view.status === "valid" ? styles.yesText : undefined}
            data-testid="verify-word"
          >
            {result.word}
          </b>
          <small>{result.detail}</small>
        </div>
      </div>
      <dl className={styles.cf}>
        <div>
          <dt>Organization</dt>
          <dd data-testid="verify-organization">{organizationWords}</dd>
        </div>
        <div>
          <dt>Statement</dt>
          <dd data-testid="verify-statement">{statementWords(BigInt(record.threshold))}</dd>
        </div>
        {view.counterpartyLabel ? (
          <div>
            <dt>Shared with</dt>
            <dd>{view.counterpartyLabel}</dd>
          </div>
        ) : null}
        <div>
          <dt>Verified at</dt>
          <dd>
            Slot {record.slot}, {dateTime(record.writtenAt)}
          </dd>
        </div>
        <div>
          <dt>{view.status === "expired" ? "Expired" : "Valid until"}</dt>
          <dd>{dateTime(record.expiry)}</dd>
        </div>
        <div>
          <dt>Balance disclosed</dt>
          <dd data-testid="verify-disclosed">none</dd>
        </div>
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
