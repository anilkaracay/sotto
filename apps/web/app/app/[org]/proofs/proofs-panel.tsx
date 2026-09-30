"use client";

// The proofs page's client part (F-13, AC-13.1 to AC-13.4; step 2.8), on the design's Proofs screen
// (the dark "New proof" card, the sky card with the certificate, the issued proofs). The owner picks a
// threshold (a chip or a custom amount), names the counterparty and how long the record stays valid,
// and the tab proves "Balance is at least $X" (proof-run.ts). Proven shows the certificate from the
// record just written, with the link to its public page; Not proven says so and sends nothing
// (AC-13.2). The issued list shows each record's state from chain; an expired record can be closed,
// its rent back to the owner (X-31).
import { getCloseProofRecordInstruction } from "@sotto/sdk/proofs";
import { Button, Card, Chip, Table, Td, Th } from "@sotto/ui";
import { address } from "@solana/kit";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { describeTransactionError } from "../../../../lib/client/transactions.ts";
import { formatDate, shortWallet } from "../../../../lib/format.ts";
import {
  DEFAULT_VALIDITY_DAYS,
  expiryWords,
  LABEL_MAX,
  NOT_PROVEN,
  NOT_PROVEN_DETAIL,
  parseThreshold,
  PROVEN,
  PROVEN_DETAIL,
  RECORD_STATE_WORDS,
  statementWords,
  THRESHOLD_CHIPS,
  VALIDITY_OPTIONS,
  verifyPath,
} from "../../../../lib/proofs.ts";
import type { IssuedProof } from "../../../../lib/server/proofs.ts";
import {
  ConfidentialProvider,
  useConfidential,
  type AvailableNetwork,
} from "../../_components/confidential/context.tsx";
import { KeysCard, WalletCard } from "../../_components/confidential/keys.tsx";
import { useSend } from "../../_components/confidential/use-send.ts";
import { SkyArt } from "../../_components/sky-art.tsx";
import { runProof, type ProofRunOutcome } from "./proof-run.ts";
import styles from "./proofs.module.css";
import { Amount, WithAmounts } from "../../_components/privacy.tsx";

type Stage =
  | { kind: "idle" }
  | { kind: "running"; text: string }
  | { kind: "done"; outcome: ProofRunOutcome; threshold: bigint; label: string };

export function ProofsPanel(props: {
  wallet: string;
  orgId: string;
  orgName: string;
  network: AvailableNetwork;
  program: string;
  proofs: IssuedProof[];
  /** The sotto_proofs config is paused (14 section 7): no new record can be written. */
  paused: boolean;
}) {
  return (
    <ConfidentialProvider
      wallet={props.wallet}
      orgId={props.orgId}
      network={props.network}
      readAccount={false}
    >
      <Proofs {...props} />
    </ConfidentialProvider>
  );
}

/** Exported for the component tests (F-19). */
export function Proofs(props: {
  orgId: string;
  orgName: string;
  network: AvailableNetwork;
  program: string;
  proofs: IssuedProof[];
  paused: boolean;
}) {
  const { connected, vault, blocked } = useConfidential();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ kind: "idle" });

  async function prove(input: { threshold: bigint; label: string; validityDays: number }) {
    if (!connected || !props.network.wrappedMint) return;
    setStage({ kind: "running", text: "Starting…" });
    const release = vault.hold();
    let outcome: ProofRunOutcome;
    try {
      outcome = await runProof({
        input: {
          orgId: props.orgId,
          threshold: input.threshold,
          label: input.label,
          validityDays: input.validityDays,
          wrappedMint: props.network.wrappedMint,
          program: props.program,
        },
        connected,
        worker: vault.worker,
        onProgress: (text) => setStage({ kind: "running", text }),
      });
    } catch (error) {
      outcome = { kind: "failed", message: describeTransactionError(error, connected.info.name) };
    } finally {
      release();
    }
    setStage({ kind: "done", outcome, threshold: input.threshold, label: input.label });
    router.refresh();
  }

  return (
    <div className={styles.grid}>
      {props.paused ? (
        <p className={styles.pausedBanner} role="alert" data-testid="proofs-paused">
          <b>Verification paused</b> The Sotto proof program is paused while an issue is looked
          into, so no new proof can be recorded right now. Proofs already issued stay onchain; their
          public pages say that verification is paused. Payments are not affected.
        </p>
      ) : null}
      <Builder
        running={stage.kind === "running"}
        again={stage.kind === "done"}
        ready={Boolean(connected?.signer && vault.unlocked && props.network.wrappedMint)}
        stopped={
          blocked ?? (props.paused ? "Paused while the Sotto proof program is paused." : null)
        }
        onProve={prove}
      />
      <CertificateCard orgName={props.orgName} stage={stage} />
      <IssuedProofs orgName={props.orgName} program={props.program} proofs={props.proofs} />
      <div className={styles.keys}>
        <WalletCard />
        <KeysCard />
      </div>
    </div>
  );
}

/** Exported for the component tests (F-19). */
export function Builder(props: {
  running: boolean;
  again: boolean;
  ready: boolean;
  /** Why proving is paused (F-19, or the program's pause), or null. */
  stopped: string | null;
  onProve: (input: { threshold: bigint; label: string; validityDays: number }) => void;
}) {
  const id = useId();
  const [choice, setChoice] = useState<number | "custom">(0);
  const [custom, setCustom] = useState("");
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<number>(DEFAULT_VALIDITY_DAYS);
  const [problem, setProblem] = useState<string | null>(null);

  function submit() {
    const threshold = choice === "custom" ? parseThreshold(custom) : THRESHOLD_CHIPS[choice]?.base;
    if (!threshold) {
      setProblem("Enter the amount to prove, in US dollars, such as 250000.");
      return;
    }
    const name = label.trim();
    if (!name) {
      setProblem("Name who the proof is for, such as a supplier or a lender.");
      return;
    }
    setProblem(null);
    props.onProve({ threshold, label: name, validityDays: days });
  }

  return (
    <Card tone="dark" className={styles.builder} data-testid="proof-builder">
      <h3 className={styles.cardTitle}>New proof</h3>
      <p className={styles.dsub}>Pick a statement and who it is for.</p>
      <div className={styles.dfl} id={`${id}-threshold`}>
        Balance is at least
      </div>
      <div className={styles.dops} role="group" aria-labelledby={`${id}-threshold`}>
        {THRESHOLD_CHIPS.map((chip, index) => (
          <button
            key={chip.label}
            type="button"
            className={choice === index ? `${styles.op} ${styles.on}` : styles.op}
            aria-pressed={choice === index}
            onClick={() => setChoice(index)}
          >
            <Amount inControl>{chip.label}</Amount>
          </button>
        ))}
        <button
          type="button"
          className={choice === "custom" ? `${styles.op} ${styles.on}` : styles.op}
          aria-pressed={choice === "custom"}
          onClick={() => setChoice("custom")}
        >
          Custom
        </button>
      </div>
      {choice === "custom" ? (
        <label className={styles.darkField}>
          <span>Custom amount (US dollars)</span>
          <input
            inputMode="decimal"
            data-amount=""
            value={custom}
            placeholder="250000"
            onChange={(event) => setCustom(event.target.value)}
          />
        </label>
      ) : null}
      <label className={styles.darkField}>
        <span className={styles.dfl}>Share the answer with</span>
        <input
          value={label}
          maxLength={LABEL_MAX}
          placeholder="Hollis Supply Co."
          onChange={(event) => setLabel(event.target.value)}
        />
      </label>
      <div className={styles.dfl} id={`${id}-validity`}>
        Valid for
      </div>
      <div className={styles.dops} role="group" aria-labelledby={`${id}-validity`}>
        {VALIDITY_OPTIONS.map((option) => (
          <button
            key={option.days}
            type="button"
            className={days === option.days ? `${styles.op} ${styles.on}` : styles.op}
            aria-pressed={days === option.days}
            onClick={() => setDays(option.days)}
          >
            {option.label}
          </button>
        ))}
      </div>
      {problem ? (
        <p className={styles.darkProblem} role="alert">
          {problem}
        </p>
      ) : null}
      <button
        type="button"
        className={styles.wb}
        disabled={!props.ready || props.running || props.stopped !== null}
        onClick={submit}
      >
        {props.running ? "Proving" : props.again ? "Generate another" : "Generate proof"}
      </button>
      {props.stopped ? (
        <p className={styles.darkProblem} role="status" data-testid="action-paused">
          {props.stopped}
        </p>
      ) : !props.ready ? (
        <p className={styles.dnote} role="status">
          Unlock your keys below to prove: the proofs are made in this tab.
        </p>
      ) : null}
      <p className={styles.dnote}>The answer is checked by a program on Solana, not by Sotto.</p>
    </Card>
  );
}

function CertificateCard({ orgName, stage }: { orgName: string; stage: Stage }) {
  return (
    <section className={styles.sky} data-testid="certificate-card">
      <SkyArt className={styles.skyArt} />
      <div className={styles.skyInner}>
        {stage.kind === "idle" ? (
          <div className={styles.czph}>
            <b>Your certificate appears here</b>
            <small>One bit leaves your account: proven or not.</small>
          </div>
        ) : stage.kind === "running" ? (
          <div className={styles.czph} role="status">
            <span className={styles.spin} aria-hidden="true" />
            <b>Generating a range proof</b>
            <small data-testid="proof-progress">
              <WithAmounts>{stage.text}</WithAmounts>
            </small>
          </div>
        ) : (
          <CertificateView
            orgName={orgName}
            outcome={stage.outcome}
            threshold={stage.threshold}
            label={stage.label}
          />
        )}
      </div>
    </section>
  );
}

/** The certificate of a finished attempt (exported for the component tests). */
export function CertificateView(props: {
  orgName: string;
  outcome: ProofRunOutcome;
  threshold: bigint;
  label: string;
  origin?: string;
}) {
  const [copied, setCopied] = useState(false);
  const { outcome } = props;
  if (outcome.kind === "failed") {
    return (
      <div className={styles.cert} data-testid="proof-failed">
        <div className={styles.cth}>
          <span>Proof of funds, {props.orgName}</span>
        </div>
        <p className={styles.certProblem} role="alert">
          <WithAmounts>{outcome.message}</WithAmounts>
        </p>
      </div>
    );
  }
  const proven = outcome.kind === "proven";
  const record = proven ? outcome.record : null;
  const link = record
    ? `${props.origin ?? (typeof window === "undefined" ? "" : window.location.origin)}${verifyPath(record.address)}`
    : null;
  return (
    <div
      className={styles.cert}
      data-testid="certificate"
      data-result={proven ? "proven" : "not-proven"}
    >
      <div className={styles.cth}>
        <span>Proof of funds, {props.orgName}</span>
        {record ? <span className="mono">{shortWallet(record.address)}</span> : null}
      </div>
      <div className={styles.cres}>
        <span
          className={proven ? `${styles.stamp} ${styles.yes}` : styles.stamp}
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
            <path d={proven ? "M5 12l5 5 9-10" : "M7 7l10 10M17 7L7 17"} />
          </svg>
        </span>
        <div>
          <b className={proven ? styles.yesText : undefined} data-testid="certificate-result">
            {proven ? PROVEN : NOT_PROVEN}
          </b>
          <small>{proven ? PROVEN_DETAIL : NOT_PROVEN_DETAIL}</small>
        </div>
      </div>
      <dl className={styles.cf}>
        <div>
          <dt>Statement</dt>
          <dd data-testid="certificate-statement">
            <WithAmounts>{statementWords(props.threshold)}</WithAmounts>
          </dd>
        </div>
        <div>
          <dt>Shared with</dt>
          <dd>{props.label}</dd>
        </div>
        {record ? (
          <>
            <div>
              <dt>Verified by</dt>
              <dd>Sotto program on Solana, slot {record.slot.toString()}</dd>
            </div>
            <div>
              <dt>Valid until</dt>
              <dd>{formatDate(new Date(Number(record.expiry) * 1000))}</dd>
            </div>
          </>
        ) : (
          <div>
            <dt>Sent onchain</dt>
            <dd>Nothing</dd>
          </div>
        )}
        <div>
          <dt>Balance disclosed</dt>
          <dd>None</dd>
        </div>
      </dl>
      {proven && outcome.kind === "proven" ? (
        <>
          {!outcome.closed ? (
            <p className={styles.certNote} role="status">
              Sotto could not close every proof account of this proof; its rent stays in them until
              they are closed.
            </p>
          ) : null}
          {outcome.stored ? (
            <p className={styles.certNote} role="status">
              The record is onchain, but the counterparty label was not saved: {outcome.stored}
            </p>
          ) : null}
          <div className={styles.cbc}>
            <a className={styles.certLink} href={record ? verifyPath(record.address) : "#"}>
              Open the public page
            </a>
            <Button
              size="sm"
              variant="line"
              data-testid="copy-link"
              onClick={() => {
                if (!link) return;
                void navigator.clipboard?.writeText(link).then(() => setCopied(true));
              }}
            >
              {copied ? "Link copied" : "Copy link"}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

function IssuedProofs(props: { orgName: string; program: string; proofs: IssuedProof[] }) {
  const { connected } = useConfidential();
  const { send, busy, problem } = useSend();
  const router = useRouter();
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <IssuedProofsView
      proofs={props.proofs}
      now={new Date()}
      copied={copied}
      busy={busy !== null}
      problem={problem}
      onCopy={(recordAddress) => {
        void navigator.clipboard
          ?.writeText(`${window.location.origin}${verifyPath(recordAddress)}`)
          .then(() => setCopied(recordAddress));
      }}
      onClose={
        connected?.signer
          ? (recordAddress) =>
              void send({
                busy: "Closing the expired record…",
                done: "The record is closed and its rent is back in your wallet.",
                build: async () => [
                  getCloseProofRecordInstruction(
                    {
                      proofRecord: address(recordAddress),
                      owner: connected.signer as NonNullable<typeof connected.signer>,
                    },
                    { programAddress: address(props.program) },
                  ),
                ],
                after: async () => router.refresh(),
              })
          : null
      }
    />
  );
}

/** The issued proofs (exported for the component tests). */
export function IssuedProofsView(props: {
  proofs: IssuedProof[];
  now: Date;
  copied: string | null;
  busy: boolean;
  problem: string | null;
  onCopy: (recordAddress: string) => void;
  onClose: ((recordAddress: string) => void) | null;
}) {
  return (
    <Card className={styles.issued} data-testid="issued-proofs">
      <div className={styles.head}>
        <h3 className={styles.cardTitleLight}>Issued proofs</h3>
        <span className={styles.count}>
          {props.proofs.length === 1 ? "1 issued" : `${props.proofs.length} issued`}
        </span>
      </div>
      {props.proofs.length === 0 ? (
        <p className={styles.empty}>No proof issued yet.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Shared with</Th>
              <Th>Statement</Th>
              <Th>Result</Th>
              <Th>Issued</Th>
              <Th>Record</Th>
              <Th align="right"> </Th>
            </tr>
          </thead>
          <tbody>
            {props.proofs.map((proof) => (
              <tr key={proof.recordAddress} data-testid="issued-row" data-state={proof.state}>
                <Td>
                  <b>{proof.counterpartyLabel}</b>
                </Td>
                <Td>
                  <WithAmounts>{statementWords(BigInt(proof.threshold))}</WithAmounts>
                </Td>
                <Td>
                  <Chip tone="green">{PROVEN}</Chip>
                </Td>
                <Td className="num">{formatDate(proof.createdAt)}</Td>
                <Td>
                  {proof.state === "closed"
                    ? RECORD_STATE_WORDS.closed
                    : expiryWords(proof.expiry, props.now)}
                </Td>
                <Td align="right">
                  <div className={styles.rowActions}>
                    {proof.state !== "closed" ? (
                      <Button
                        size="sm"
                        variant="line"
                        onClick={() => props.onCopy(proof.recordAddress)}
                      >
                        {props.copied === proof.recordAddress ? "Link copied" : "Copy link"}
                      </Button>
                    ) : null}
                    {proof.state === "expired" && props.onClose ? (
                      <Button
                        size="sm"
                        variant="line"
                        disabled={props.busy}
                        onClick={() => props.onClose?.(proof.recordAddress)}
                      >
                        Close
                      </Button>
                    ) : null}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {props.problem ? (
        <p className={styles.problem} role="alert">
          {props.problem}
        </p>
      ) : null}
    </Card>
  );
}
