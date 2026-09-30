"use client";

// The payroll run page's client part (F-08; step 2.3), on the design's payroll screen:
// - Run total: the lines' amounts opened in the tab with the viewing key, by team, and the steps
//   Upload, Validate, Approve, Settle on Solana;
// - Settlement: the gauge (X-18: a tick per line from 12 to 48 lines, filled as lines settle), the
//   approvals block with the initiator's approval only (Q-12, 13 A31) and Approve and run, which asks
//   the server to authorize the run (every line ready from chain and screened, before anything is
//   signed), then pays the lines in chunks in this tab (payroll-run.ts); Resume after a stop;
// - Recipients: each line's status (AC-08.4), a blocked line's reason, and removing it from a draft;
// - Who can read this run: you, each recipient with a viewing key for their own line, since step 2.4
//   each holder of a viewing grant with the lines they hold records of, and the chain without amounts
//   (13 A26: no board line).
import { Button, Card, Chip, Table, Td, Th } from "@sotto/ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { ApiCallError, callApi } from "../../../../../lib/client/api.ts";
import { GRANT_COPIES_MISSING } from "../../../../../lib/client/records.ts";
import { describeTransactionError } from "../../../../../lib/client/transactions.ts";
import { CryptoWorkerError } from "../../../../../lib/crypto-worker/client.ts";
import { shortWallet } from "../../../../../lib/format.ts";
import {
  blockedReason,
  filledTicks,
  formatUsdc,
  gaugeTicks,
  lineStatusChip,
  parseLinePrivate,
  runStatusChip,
  type PayrollLinePrivate,
} from "../../../../../lib/payroll.ts";
import type { PayrollLineView, PayrollRunView } from "../../../../../lib/server/payroll.ts";
import {
  ConfidentialProvider,
  useConfidential,
  type AvailableNetwork,
} from "../../../_components/confidential/context.tsx";
import { PausedNote } from "../../../_components/confidential/paused-note.tsx";
import { KeysCard, WalletCard } from "../../../_components/confidential/keys.tsx";
import { useKeySession } from "../../../_components/key-session.tsx";
import cards from "../../../_components/confidential/cards.module.css";
import styles from "../payroll.module.css";
import {
  discloseLines,
  runPayroll,
  type DisclosureResult,
  type RunLine,
  type ViewerKeyRecord,
} from "./payroll-run.ts";

type Progress = { busy: string | null; problem: string | null; done: string | null };
const IDLE: Progress = { busy: null, problem: null, done: null };
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const RUNNABLE = ["draft", "awaiting_approval", "approved"];
const RESUMABLE = ["partially_settled", "failed"];

export function RunPanel(props: {
  wallet: string;
  orgId: string;
  network: AvailableNetwork;
  run: PayrollRunView;
  you: { displayName: string | null };
  viewerKeys: Record<string, ViewerKeyRecord>;
  ownerKey: ViewerKeyRecord | null;
}) {
  return (
    <ConfidentialProvider
      wallet={props.wallet}
      orgId={props.orgId}
      network={props.network}
      readAccount={false}
    >
      <RunView {...props} />
    </ConfidentialProvider>
  );
}

/** The transfer signature a settled line's disclosure names. */
function transferOf(line: PayrollLineView): string | null {
  const finalized = line.attempts.find((attempt) => attempt.status === "finalized");
  return finalized?.transferSignature ?? line.attempts.at(-1)?.transferSignature ?? null;
}

/** Exported for the component tests (F-19). */
export function RunView(props: {
  orgId: string;
  run: PayrollRunView;
  you: { displayName: string | null };
  viewerKeys: Record<string, ViewerKeyRecord>;
  ownerKey: ViewerKeyRecord | null;
}) {
  const { orgId, ownerKey, viewerKeys } = props;
  const { wallet, network, connected, vault, blocked } = useConfidential();
  const { session, viewing } = useKeySession();
  const router = useRouter();
  const [view, setView] = useState(props.run);
  const [opened, setOpened] = useState<Record<string, PayrollLinePrivate | "unreadable">>({});
  const [progress, setProgress] = useState<Progress>(IDLE);
  const [landed, setLanded] = useState<Set<string>>(() => new Set());
  const unlocked = viewing?.wallet === wallet;

  const reload = useCallback(async () => {
    const { run } = await callApi<{ run: PayrollRunView }>(
      `/api/orgs/${orgId}/payroll-runs/${view.id}`,
    );
    setView(run);
    return run;
  }, [orgId, view.id]);

  // While the tab holds the viewing key, the lines' amounts open for this page only.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, PayrollLinePrivate | "unreadable"> = {};
      if (unlocked) {
        for (const line of view.lines) {
          if (!line.privateBlob) continue;
          try {
            next[line.id] =
              parseLinePrivate(await session.worker().openSealed(fromBase64(line.privateBlob))) ??
              "unreadable";
          } catch {
            next[line.id] = "unreadable";
          }
        }
      }
      if (!cancelled) setOpened(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, view.lines, session]);

  // AC-08.4: while the run settles, its lines' statuses are read again every few seconds.
  const settling = view.status === "executing" || progress.busy !== null;
  useEffect(() => {
    if (!settling) return;
    const timer = setInterval(() => void reload().catch(() => undefined), 3000);
    return () => clearInterval(timer);
  }, [settling, reload]);

  const settled = view.lines.filter((line) => line.status === "settled").length;
  const lines = view.lines.length;
  const secrets = view.lines.map((line) => opened[line.id]);
  const allOpen = unlocked && secrets.every((secret) => secret && secret !== "unreadable");
  const total = allOpen
    ? secrets.reduce((sum, secret) => sum + BigInt((secret as PayrollLinePrivate).amount), 0n)
    : null;
  const byTeam = new Map<string, bigint>();
  if (allOpen) {
    view.lines.forEach((line, index) => {
      const team = line.recipient.team ?? "No team";
      const amount = BigInt((secrets[index] as PayrollLinePrivate).amount);
      byTeam.set(team, (byTeam.get(team) ?? 0n) + amount);
    });
  }
  const teams = [...byTeam.entries()].sort((a, b) => (a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : 0));
  const executed = view.approvals.execution !== null;
  const missingRecords = view.lines.filter((line) => line.status === "settled" && !line.disclosed);
  const canAct = Boolean(connected?.signer && vault.unlocked && unlocked && ownerKey && allOpen);

  function runLinesOf(run: PayrollRunView, status: string): RunLine[] {
    return run.lines
      .filter((line) => line.status === status)
      .map((line) => ({
        line,
        secret: opened[line.id] as PayrollLinePrivate,
        viewerKey: viewerKeys[line.recipientId] ?? null,
      }));
  }

  /** X-33: the records of settled lines that have none yet, under one manifest. */
  async function saveRecords(run: PayrollRunView): Promise<DisclosureResult | null> {
    if (!connected || !ownerKey) return null;
    const pending = run.lines
      .filter((line) => line.status === "settled" && !line.disclosed && transferOf(line))
      .map((line) => ({
        line: {
          line,
          secret: opened[line.id] as PayrollLinePrivate,
          viewerKey: viewerKeys[line.recipientId] ?? null,
        },
        transferSignature: transferOf(line) as string,
      }));
    if (pending.length === 0) return null;
    setProgress({
      busy: "Saving the records of the settled lines, encrypted for you and each recipient…",
      problem: null,
      done: null,
    });
    return discloseLines({
      orgId,
      lines: pending,
      owner: ownerKey,
      connected,
      worker: vault.worker,
    });
  }

  async function run() {
    if (!connected || !ownerKey || !network.wrappedMint || !canAct || blocked) return;
    setProgress({
      busy: "Checking every recipient's account, screening and approvals…",
      problem: null,
      done: null,
    });
    const release = vault.hold();
    try {
      const saved = RESUMABLE.includes(view.status) ? await saveRecords(view) : null;
      const recordProblem =
        saved?.problem ?? (saved?.grantCopiesMissing ? GRANT_COPIES_MISSING : null);
      let authorized: PayrollRunView;
      try {
        authorized = (
          await callApi<{ run: PayrollRunView }>(
            `/api/orgs/${orgId}/payroll-runs/${view.id}/authorize`,
            { method: "POST" },
          )
        ).run;
      } catch (error) {
        await reload().catch(() => undefined);
        setProgress({
          busy: null,
          problem:
            error instanceof ApiCallError ? error.message : "The run could not be authorized.",
          done: null,
        });
        return;
      }
      setView(authorized);
      const toPay = runLinesOf(authorized, "authorized");
      if (toPay.length === 0) {
        setProgress({
          busy: null,
          problem: recordProblem,
          done: "Every line of this run landed; Sotto records each one as settled at finality.",
        });
        return;
      }
      const outcome = await runPayroll({
        orgId,
        runId: view.id,
        lines: toPay,
        owner: ownerKey,
        wrappedMint: network.wrappedMint,
        connected,
        worker: vault.worker,
        onProgress: (busy) => setProgress({ busy, problem: null, done: null }),
        onLanded: (lineId) => setLanded((current) => new Set([...current, lineId])),
      });
      const records = outcome.records.problem
        ? ` ${outcome.records.problem}`
        : outcome.records.saved > 0
          ? `${
              outcome.records.ownerOnly > 0
                ? ` The payroll records are saved, encrypted for you and each recipient with a viewing key; ${outcome.records.ownerOnly} ${outcome.records.ownerOnly === 1 ? "recipient has" : "recipients have"} none yet.`
                : " The payroll records are saved, encrypted for you and each recipient."
            }${outcome.records.grantCopiesMissing ? ` ${GRANT_COPIES_MISSING}` : ""}`
          : "";
      setProgress(
        outcome.kind === "done"
          ? {
              busy: null,
              problem: recordProblem,
              done: `${outcome.landed} ${outcome.landed === 1 ? "line was" : "lines were"} sent and confirmed; each settles on Solana with its own transfer.${records}`,
            }
          : { busy: null, problem: `${outcome.message}${records}`, done: null },
      );
    } catch (error) {
      setProgress({
        busy: null,
        problem:
          error instanceof CryptoWorkerError && error.code === "insufficient_balance"
            ? "Your available confidential balance is below what these lines pay. Nothing more was sent."
            : error instanceof CryptoWorkerError && error.code === "recipient_not_ready"
              ? "A recipient's account cannot receive a confidential transfer right now. Nothing more was sent."
              : describeTransactionError(error, connected.info.name),
        done: null,
      });
    } finally {
      release();
      await reload().catch(() => undefined);
      router.refresh();
    }
  }

  async function save() {
    const release = vault.hold();
    try {
      const saved = await saveRecords(view);
      const problem = saved?.problem ?? null;
      setProgress({
        busy: null,
        problem,
        done: problem
          ? null
          : `The records of the settled lines are saved.${saved?.grantCopiesMissing ? ` ${GRANT_COPIES_MISSING}` : ""}`,
      });
    } catch {
      setProgress({ busy: null, problem: "The records could not be saved.", done: null });
    } finally {
      release();
      await reload().catch(() => undefined);
    }
  }

  async function remove(lineId: string) {
    try {
      setView(
        (
          await callApi<{ run: PayrollRunView }>(
            `/api/orgs/${orgId}/payroll-runs/${view.id}/lines/${lineId}`,
            { method: "DELETE" },
          )
        ).run,
      );
      setProgress(IDLE);
    } catch (error) {
      setProgress({
        busy: null,
        problem: error instanceof ApiCallError ? error.message : "The line could not be removed.",
        done: null,
      });
    }
  }

  const status = runStatusChip(view.status);
  const button = RUNNABLE.includes(view.status)
    ? "Approve and run"
    : RESUMABLE.includes(view.status)
      ? "Resume"
      : view.status === "settled"
        ? "Payroll settled"
        : "Settling";
  const actionable = RUNNABLE.includes(view.status) || RESUMABLE.includes(view.status);
  const head = `${settled} of ${lines} paid`;
  const sub =
    view.status === "settled"
      ? `${lines} ${lines === 1 ? "transfer" : "transfers"} settled on Solana, amounts sealed`
      : view.status === "executing"
        ? "Each line settles on Solana with its own transfer"
        : view.status === "partially_settled"
          ? "Resume to pay the lines that did not settle"
          : view.status === "failed"
            ? "No line was paid; resume to try again"
            : "Waiting for you to approve and run";
  const initiator = view.createdBy.displayName ?? shortWallet(view.createdBy.wallet);

  return (
    <div className={styles.page}>
      <Card tone="dark" className={styles.s8} data-testid="run-total">
        <div className={styles.cardHead}>
          <h3>Run total</h3>
          <Chip tone={status.tone} data-testid="run-status" data-status={view.status}>
            {status.label}
          </Chip>
        </div>
        {total !== null ? (
          <>
            <div className={styles.big}>
              <b className="num" data-testid="run-total-amount">
                {formatUsdc(total)}
              </b>
              <small>
                {lines} {lines === 1 ? "line" : "lines"}, by team
              </small>
            </div>
            <div
              className={styles.bars}
              style={{
                gridTemplateColumns: `repeat(${Math.max(teams.length, 1)}, minmax(0, 1fr))`,
              }}
            >
              {teams.map(([team, amount], index) => {
                const max = teams[0]?.[1] ?? 1n;
                const height = max > 0n ? Number((amount * 1000n) / max) / 10 : 0;
                return (
                  <div key={team} className={styles.col}>
                    <span className={styles.barValue}>{formatUsdc(amount)}</span>
                    <div
                      className={`${styles.bar} ${index === 0 ? styles.on : ""}`}
                      style={{
                        height: `${Math.max(height * 0.8, 4)}%`,
                        animationDelay: `${index * 0.07}s`,
                      }}
                    />
                    <span className={styles.barLabel}>{team}</span>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <p className={styles.sealed} data-testid="run-total-sealed">
            Sealed. The amounts open in this tab once you unlock your keys.
          </p>
        )}
        <div className={styles.steps}>
          <div className={`${styles.step} ${styles.done}`}>
            <i>1</i>Upload
          </div>
          <div className={`${styles.step} ${styles.done}`}>
            <i>2</i>Validate
          </div>
          <div className={`${styles.step} ${executed ? styles.done : styles.cur}`}>
            <i>3</i>Approve
          </div>
          <div
            className={`${styles.step} ${view.status === "settled" ? styles.done : executed ? styles.cur : ""}`}
          >
            <i>4</i>Settle on Solana
          </div>
        </div>
      </Card>

      <Card tone="dark" className={styles.s4} data-testid="settlement">
        <div className={styles.cardHead}>
          <h3>Settlement</h3>
          <span className={styles.periodChip}>{view.period}</span>
        </div>
        <Gauge lines={lines} settled={settled} head={head} sub={sub} />
        <div className={styles.approvals} data-testid="approvals">
          <div className={styles.approver}>
            <span className={styles.avatar} aria-hidden="true">
              {initiator.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <b>{initiator}</b>
              <small>You</small>
            </div>
            <Chip tone={executed ? "green" : "amber"} data-testid="approval-chip">
              {executed ? "Approved" : "Waiting for you"}
            </Chip>
          </div>
          <p className={styles.approvalNote}>
            Running the payroll is your approval. Sotto records it with the execution signature.
          </p>
        </div>
        <Button
          variant="blue"
          className={styles.runButton}
          disabled={!actionable || !canAct || progress.busy !== null || blocked !== null}
          onClick={() => void run()}
          data-testid="run-button"
        >
          {progress.busy ? "Settling" : button}
        </Button>
        {actionable ? <PausedNote /> : null}
        {actionable && !canAct ? (
          <p className={styles.approvalNote}>
            {!ownerKey
              ? "Create your viewing key on the Account setup page first."
              : "Connect your wallet and unlock your keys to run: the proofs are made in this tab."}
          </p>
        ) : null}
        {progress.busy ? (
          <p className={styles.status} role="status" data-testid="run-progress">
            {progress.busy}
          </p>
        ) : null}
        {progress.done ? (
          <p className={styles.done} role="status" data-testid="run-done">
            {progress.done}
          </p>
        ) : null}
        {progress.problem ? (
          <p className={styles.problem} role="alert" data-testid="run-problem">
            {progress.problem}
          </p>
        ) : null}
        {missingRecords.length > 0 && !settling && canAct ? (
          <Button variant="line" size="sm" className={styles.runButton} onClick={() => void save()}>
            Save the records of {missingRecords.length} settled{" "}
            {missingRecords.length === 1 ? "line" : "lines"}
          </Button>
        ) : null}
      </Card>

      <Card data-testid="run-recipients">
        <div className={cards.head}>
          <h2 className={cards.cardTitle}>Recipients</h2>
          <small className={styles.muted}>
            {lines} {lines === 1 ? "person" : "people"}
          </small>
        </div>
        <div className={styles.scroll}>
          <Table>
            <thead>
              <tr>
                <Th>Person</Th>
                <Th>Location</Th>
                <Th>Paid to</Th>
                <Th align="right">Amount</Th>
                <Th align="right">Status</Th>
              </tr>
            </thead>
            <tbody>
              {view.lines.map((line) => {
                const secret = opened[line.id];
                const chip =
                  line.status !== "settled" && landed.has(line.id) && line.status !== "failed"
                    ? { label: "Settling", tone: "amber" as const }
                    : lineStatusChip(line.status, line.errorCode);
                const reason = blockedReason(line.errorCode);
                return (
                  <tr
                    key={line.id}
                    data-testid="run-line"
                    data-status={line.status}
                    data-line={line.lineNo}
                  >
                    <Td>
                      <span className={styles.person}>
                        <b>{line.recipient.displayName}</b>
                        <small>{line.recipient.roleTitle ?? line.recipient.team ?? ""}</small>
                      </span>
                    </Td>
                    <Td>{line.recipient.country ?? <span className={styles.muted}>None</span>}</Td>
                    <Td>
                      <span className="mono">{shortWallet(line.recipient.wallet)}</span>
                    </Td>
                    <Td align="right">
                      {!unlocked || secret === undefined ? (
                        <span className={styles.muted}>Sealed</span>
                      ) : secret === "unreadable" ? (
                        <span className={styles.muted}>Not readable with this key</span>
                      ) : (
                        <span className="num" data-testid="line-amount">
                          {formatUsdc(BigInt(secret.amount))}
                        </span>
                      )}
                    </Td>
                    <Td align="right">
                      <Chip tone={chip.tone} data-testid="line-status">
                        {chip.label}
                      </Chip>
                      {reason ? (
                        <span className={styles.reason} data-testid="line-reason">
                          {reason}
                        </span>
                      ) : null}
                      {reason && ["draft", "awaiting_approval"].includes(view.status) ? (
                        <Button
                          variant="line"
                          size="sm"
                          onClick={() => void remove(line.id)}
                          disabled={progress.busy !== null}
                        >
                          Remove from this run
                        </Button>
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      </Card>

      <Card className={styles.s4} data-testid="who-can-read">
        <h2 className={cards.cardTitle}>Who can read this run</h2>
        <div className={styles.who}>
          <div>
            <span className={styles.dot} />
            <span>You, every line</span>
          </div>
          <div>
            <span className={styles.dot} />
            <span>
              Each person with a viewing key, their own line (
              {view.lines.filter((line) => viewerKeys[line.recipientId]).length} of {lines})
            </span>
          </div>
          {view.readers.map((reader) => (
            <div key={reader.grantId} data-testid="who-reader">
              <span className={styles.dot} />
              <span>
                {reader.holder},{" "}
                {reader.lines >= lines
                  ? "every line"
                  : `${reader.lines} of ${lines} ${lines === 1 ? "line" : "lines"}`}
              </span>
            </div>
          ))}
          <div>
            <span className={`${styles.dot} ${styles.faint}`} />
            <span>
              Everyone else, {lines} {lines === 1 ? "payment" : "payments"} with no amounts
            </span>
          </div>
        </div>
      </Card>
      <div className={`${styles.s4} ${styles.side}`}>
        <WalletCard />
      </div>
      <div className={`${styles.s4} ${styles.side}`}>
        <KeysCard />
      </div>
    </div>
  );
}

/** The radial tick gauge (design .rd2): X-18 ticks, lit as lines settle. */
export function Gauge({
  lines,
  settled,
  head,
  sub,
}: {
  lines: number;
  settled: number;
  head: string;
  sub: string;
}) {
  const { ticks } = gaugeTicks(lines);
  const lit = filledTicks(lines, settled);
  const start = [31, 91, 232];
  const end = [124, 58, 237];
  return (
    <div className={styles.gauge} data-testid="gauge" data-ticks={ticks} data-lit={lit}>
      <svg viewBox="0 0 300 170" aria-hidden="true">
        {Array.from({ length: ticks }, (_, index) => {
          const angle = Math.PI * (1 - index / Math.max(ticks - 1, 1));
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const t = index / Math.max(ticks - 1, 1);
          const color = start.map((from, channel) =>
            Math.round(from + ((end[channel] ?? from) - from) * t),
          );
          return (
            <line
              key={index}
              x1={(150 + 92 * cos).toFixed(1)}
              y1={(160 - 92 * sin).toFixed(1)}
              x2={(150 + 132 * cos).toFixed(1)}
              y2={(160 - 132 * sin).toFixed(1)}
              className={index < lit ? styles.lit : undefined}
              style={{ "--c": `rgb(${color.join(",")})` } as CSSProperties}
            />
          );
        })}
      </svg>
      <div className={styles.gaugeText}>
        <b data-testid="gauge-head">{head}</b>
        <small>{sub}</small>
      </div>
    </div>
  );
}
