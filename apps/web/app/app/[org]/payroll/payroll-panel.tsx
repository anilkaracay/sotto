"use client";

// The payroll page's client part (F-08, AC-08.1, AC-08.2; step 2.3). The owner uploads a CSV with the
// header of AC-08.1; the tab reads it and validates every row, matching rows to existing recipients by
// wallet. When every row is valid, each line's amount, memo, gross and tax are sealed in the tab to
// the owner's own viewing key (the line's private blob) and the run is created as a draft; nothing
// in plaintext leaves the tab. The runs list shows each run's status and how many lines settled.
import { verifyViewKeyRegistration } from "@sotto/sdk/keys/public";
import { Button, Card, Chip, Table, Td, Th } from "@sotto/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, type ChangeEvent } from "react";
import { ApiCallError, callApi } from "../../../../lib/client/api.ts";
import { formatDate, shortWallet } from "../../../../lib/format.ts";
import {
  CSV_COLUMNS,
  CSV_EXTENSION_COLUMNS,
  formatUsdc,
  linePrivateOf,
  parsePayrollCsv,
  runStatusChip,
  TITLE_MAX,
  type CsvRecipient,
  type ParsedCsv,
} from "../../../../lib/payroll.ts";
import type { PayrollRunSummary, PayrollRunView } from "../../../../lib/server/payroll.ts";
import cards from "../../_components/confidential/cards.module.css";
import {
  ConfidentialProvider,
  useConfidential,
  type AvailableNetwork,
} from "../../_components/confidential/context.tsx";
import styles from "./payroll.module.css";
import { Amount } from "../../_components/privacy.tsx";

export type ViewerKeyRecord = {
  userId: string;
  wallet: string;
  publicKey: string;
  signature: string;
};

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** The current month in UTC as YYYY-MM, and the default title for a period. */
export function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
export function titleFor(period: string): string {
  const month = MONTHS[Number(period.slice(5, 7)) - 1];
  return month ? `${month} payroll` : "Payroll";
}

export function PayrollPanel(props: {
  wallet: string;
  orgId: string;
  network: AvailableNetwork;
  recipients: CsvRecipient[];
  runs: PayrollRunSummary[];
  ownerKey: ViewerKeyRecord | null;
}) {
  return (
    <ConfidentialProvider
      wallet={props.wallet}
      orgId={props.orgId}
      network={props.network}
      readAccount={false}
    >
      <div className={styles.page}>
        <NewRunCard recipients={props.recipients} ownerKey={props.ownerKey} />
        <RunsCard runs={props.runs} />
      </div>
    </ConfidentialProvider>
  );
}

type Draft = { parsed: ParsedCsv; name: string; runKey: string; lineKeys: string[] };

function NewRunCard({
  recipients,
  ownerKey,
}: {
  recipients: CsvRecipient[];
  ownerKey: ViewerKeyRecord | null;
}) {
  const { wallet, orgId, vault } = useConfidential();
  const router = useRouter();
  const id = useId();
  const [period, setPeriod] = useState(currentPeriod);
  const [title, setTitle] = useState(() => titleFor(currentPeriod()));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const rows = draft?.parsed.rows ?? [];
  const invalid = rows.filter((row) => row.errors.length > 0).length;
  const total = rows.reduce((sum, row) => sum + (row.base ?? 0n), 0n);
  const fileErrors = draft?.parsed.fileErrors ?? [];
  const ready =
    ownerKey !== null &&
    draft !== null &&
    rows.length > 0 &&
    invalid === 0 &&
    fileErrors.length === 0 &&
    title.trim().length > 0;

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setProblem(null);
    if (!file) {
      setDraft(null);
      return;
    }
    const parsed = parsePayrollCsv(await file.text(), recipients);
    // One idempotency key per run and per line the owner means to create (I-7).
    setDraft({
      parsed,
      name: file.name,
      runKey: crypto.randomUUID(),
      lineKeys: parsed.rows.map(() => crypto.randomUUID()),
    });
  }

  async function create() {
    if (!draft || !ownerKey || !ready) return;
    setBusy(true);
    setProblem(null);
    try {
      // I-8: the owner's viewing key is used only after its registration verifies.
      const publicKey = fromBase64(ownerKey.publicKey);
      const verified = await verifyViewKeyRegistration({
        wallet,
        publicKey,
        signature: fromBase64(ownerKey.signature),
      });
      if (!verified) {
        setProblem(
          "Your viewing key's registration does not verify for your wallet, so Sotto does not encrypt to it.",
        );
        return;
      }
      const lines = [];
      for (const [index, row] of draft.parsed.rows.entries()) {
        if (!row.recipient) throw new Error("a valid row has a recipient");
        lines.push({
          recipientId: row.recipient.id,
          idempotencyKey: draft.lineKeys[index] ?? crypto.randomUUID(),
          privateBlob: toBase64(await vault.worker().seal(publicKey, linePrivateOf(row))),
        });
      }
      const { run } = await callApi<{ run: PayrollRunView }>(`/api/orgs/${orgId}/payroll-runs`, {
        method: "POST",
        body: { title: title.trim(), period, idempotencyKey: draft.runKey, lines },
      });
      router.push(`/app/${orgId}/payroll/${run.id}`);
    } catch (error) {
      setProblem(
        error instanceof ApiCallError ? error.message : "The payroll run could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="new-run-card">
      <h2 className={cards.cardTitle}>New payroll run</h2>
      <p className={styles.lead}>
        Upload a CSV with the header <code className="mono">{CSV_COLUMNS.join(",")}</code>, and
        optionally <code className="mono">{CSV_EXTENSION_COLUMNS.join(",")}</code> for payslips.
        Amounts are in USDC with at most 6 decimals. Each row must be a recipient you already added.
        The file is read in this tab; the amounts and memos are encrypted in this tab to your
        viewing key, and Sotto stores them sealed.
      </p>
      {!ownerKey ? (
        <p className={styles.warning} role="status">
          Create your viewing key on the Account setup page first: each line is sealed to it.
        </p>
      ) : null}
      <div className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-period`}>
            Pay period
          </label>
          <input
            id={`${id}-period`}
            className={styles.control}
            type="month"
            value={period}
            onChange={(event) => {
              const next = event.target.value;
              if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(next)) return;
              if (title === titleFor(period)) setTitle(titleFor(next));
              setPeriod(next);
            }}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${id}-title`}>
            Title
          </label>
          <input
            id={`${id}-title`}
            className={styles.control}
            value={title}
            maxLength={TITLE_MAX}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className={`${styles.field} ${styles.wide}`}>
          <label className={styles.label} htmlFor={`${id}-file`}>
            Payroll CSV
          </label>
          <input
            id={`${id}-file`}
            className={styles.file}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => void choose(event)}
          />
        </div>
      </div>
      {fileErrors.length > 0 ? (
        <p className={styles.problem} role="alert" data-testid="csv-file-error">
          {fileErrors.join(" ")}
        </p>
      ) : null}
      {rows.length > 0 ? (
        <>
          <p className={styles.summary} data-testid="csv-summary">
            {rows.length} {rows.length === 1 ? "line" : "lines"} from {draft?.name},{" "}
            {invalid === 0 ? (
              <>
                <Amount>{formatUsdc(total)}</Amount> in total.
              </>
            ) : (
              `${invalid} ${invalid === 1 ? "row needs" : "rows need"} a fix before the run can be created.`
            )}
          </p>
          <div className={styles.scroll}>
            <Table>
              <thead>
                <tr>
                  <Th>Row</Th>
                  <Th>Recipient</Th>
                  <Th align="right">Amount</Th>
                  <Th>Memo</Th>
                  <Th>Check</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.row}
                    data-testid="csv-row"
                    data-state={row.errors.length > 0 ? "error" : "ok"}
                  >
                    <Td className="num">{row.row}</Td>
                    <Td>
                      <span className={styles.person}>
                        <b>{row.recipient?.displayName ?? (row.name || "Unknown")}</b>
                        <small className="mono">
                          {row.wallet ? shortWallet(row.wallet) : "No wallet"}
                        </small>
                      </span>
                    </Td>
                    <Td align="right" className="num">
                      {row.base !== null ? (
                        <Amount>{formatUsdc(row.base)}</Amount>
                      ) : row.amount ? (
                        <Amount>{row.amount}</Amount>
                      ) : (
                        "None"
                      )}
                    </Td>
                    <Td>{row.memo || <span className={styles.muted}>None</span>}</Td>
                    <Td>
                      {row.errors.length > 0 ? (
                        <span className={styles.rowError} data-testid="csv-row-error">
                          {row.errors.join(" ")}
                        </span>
                      ) : row.warning ? (
                        <span className={styles.rowWarning}>{row.warning}</span>
                      ) : (
                        <Chip tone="green">Valid</Chip>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </>
      ) : null}
      <div className={styles.actions}>
        <Button variant="blue" disabled={!ready || busy} onClick={() => void create()}>
          {busy ? "Creating…" : "Create run"}
        </Button>
      </div>
      {problem ? (
        <p className={styles.problem} role="alert" data-testid="run-create-problem">
          {problem}
        </p>
      ) : null}
    </Card>
  );
}

function RunsCard({ runs }: { runs: PayrollRunSummary[] }) {
  const { orgId } = useConfidential();
  return (
    <Card data-testid="runs-card">
      <h2 className={cards.cardTitle}>Runs</h2>
      {runs.length === 0 ? (
        <p className={styles.empty}>No payroll runs yet. Upload a CSV to create the first one.</p>
      ) : (
        <div className={styles.scroll}>
          <Table>
            <thead>
              <tr>
                <Th>Run</Th>
                <Th>Period</Th>
                <Th align="right">Lines</Th>
                <Th>Status</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} data-testid="run-row" data-status={run.status}>
                  <Td>
                    <Link className={styles.runLink} href={`/app/${orgId}/payroll/${run.id}`}>
                      {run.title}
                    </Link>
                  </Td>
                  <Td className="mono">{run.period}</Td>
                  <Td align="right" className="num">
                    {run.settled} of {run.lineCount} settled
                  </Td>
                  <Td>
                    <Chip tone={runStatusChip(run.status).tone}>
                      {runStatusChip(run.status).label}
                    </Chip>
                  </Td>
                  <Td>{formatDate(run.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}
