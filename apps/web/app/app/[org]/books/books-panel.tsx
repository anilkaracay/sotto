"use client";

// The accountant's books (F-11, AC-11.1 to AC-11.4; step 2.5), on the design's Books screen where data
// exists (13 A45, A46):
// - the header: the org, read only until the grant ends, the month tabs and Export; the scope banner
//   says who shared the books, what they read and until when (AC-11.1);
// - Money out: the dark hero of the design with money out instead of money in (M1), the total of the
//   months shown and a glowing bar per month, all sums of the accountant's records opened in this tab;
// - By category and Reconciliation: sums by the payload category, and how many payments need a
//   receipt (status only, D-27);
// - the Ledger: the records opened in this tab, filtered by month, category or "Needs receipt", and
//   searched in memory (AC-11.2); a row opens the payment drawer with what each party sees and the
//   audit trail, where the accountant marks it reconciled (AC-11.3);
// - Export: a CSV of the rows the ledger shows, generated in this tab after the server recorded the
//   export event, so the owner sees every export in the access log (AC-11.4).
// Every record is verified against the owner's manifest before it opens (I-9); nothing opens before
// the viewing key is unlocked in this tab, and no figure is shown while locked.
import type { DisclosurePayloadV1 } from "@sotto/sdk/disclosure";
import { Button, Card, Chip, Drawer, initials, PageHeader, Table, Td, Th } from "@sotto/ui";
import { useEffect, useState, type ReactNode } from "react";
import {
  BOOKS_CATEGORY_LABEL,
  categoryTotals,
  filterRows,
  ledgerCsv,
  ledgerRows,
  monthLabel,
  monthsOf,
  monthTotals,
  rangeLabel,
  sum,
  type LedgerFilter,
  type LedgerRow,
} from "../../../../lib/books.ts";
import { ApiCallError, callApi } from "../../../../lib/client/api.ts";
import { openDisclosures } from "../../../../lib/client/disclosures.ts";
import { formatDate, shortWallet } from "../../../../lib/format.ts";
import { expiryWords, scopeWords } from "../../../../lib/grant.ts";
import type { BooksPaymentView, BooksView } from "../../../../lib/server/books.ts";
import type { DisclosureItemView, ManifestView } from "../../../../lib/server/disclosures.ts";
import cards from "../../_components/confidential/cards.module.css";
import notices from "../../_components/confidential/confidential.module.css";
import {
  ConfidentialProvider,
  useConfidential,
  type AvailableNetwork,
} from "../../_components/confidential/context.tsx";
import { ViewingUnlockCard, WalletCard } from "../../_components/confidential/keys.tsx";
import { useKeySession } from "../../_components/key-session.tsx";
import { MonthBars } from "../../_components/month-bars.tsx";
import styles from "./books.module.css";
import { Amount } from "../../_components/privacy.tsx";
import { formatAmount } from "../../../../lib/asset-words.ts";
import { AssetBadge, useAssetWords } from "../../_components/asset.tsx";

type Records = { items: DisclosureItemView[]; manifests: ManifestView[] };

export function BooksPanel(props: {
  wallet: string;
  you: string;
  books: BooksView;
  network: AvailableNetwork;
}) {
  return (
    <ConfidentialProvider
      wallet={props.wallet}
      orgId={props.books.org.id}
      network={props.network}
      readAccount={false}
    >
      <BooksLive you={props.you} books={props.books} />
    </ConfidentialProvider>
  );
}

function BooksLive({ you, books }: { you: string; books: BooksView }) {
  const { orgId, wallet } = useConfidential();
  const { session, viewing } = useKeySession();
  const unlocked = viewing?.wallet === wallet;
  const [payments, setPayments] = useState(books.payments);
  const [records, setRecords] = useState<Records | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [opened, setOpened] = useState<{
    payloads: DisclosurePayloadV1[];
    unverified: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void callApi<Records>(`/api/orgs/${orgId}/disclosures`).then(
      (loaded) => {
        if (!cancelled) setRecords(loaded);
      },
      () => {
        if (!cancelled)
          setProblem("Your records could not be loaded. Reload the page to try again.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // While the tab holds the viewing key, the records open for this page only (I-9 first).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!records || !unlocked) {
        if (!cancelled) setOpened(null);
        return;
      }
      const items = await openDisclosures({
        orgId,
        ownerWallet: books.ownerWallet,
        viewerUserId: you,
        items: records.items,
        manifests: records.manifests,
        open: (ciphertext) => session.openWorker().openSealed(ciphertext),
      });
      const payloads = items.flatMap((item) => (item.state === "opened" ? [item.payload] : []));
      const unverified = items.filter((item) => item.state === "unverified").length;
      if (!cancelled) setOpened({ payloads, unverified });
    })();
    return () => {
      cancelled = true;
    };
  }, [records, unlocked, session, orgId, books.ownerWallet, you]);

  async function reconcile(paymentId: string, status: "matched" | "needs_receipt") {
    const { reconciliation } = await callApi<{
      reconciliation: NonNullable<BooksPaymentView["reconciliation"]>;
    }>(`/api/orgs/${orgId}/reconciliations/${paymentId}`, { method: "PUT", body: { status } });
    setPayments((current) =>
      current.map((payment) =>
        payment.id === paymentId ? { ...payment, reconciliation } : payment,
      ),
    );
  }

  return (
    <BooksScreen
      books={books}
      payments={payments}
      rows={opened ? ledgerRows(opened.payloads, payments) : null}
      unverified={opened?.unverified ?? 0}
      problem={problem}
      onReconcile={reconcile}
      side={
        <>
          <div className={styles.s6}>
            <WalletCard />
          </div>
          <div className={styles.s6}>
            <ViewingUnlockCard />
          </div>
        </>
      }
    />
  );
}

const initial = (name: string) => initials(name) || "?";

/**
 * The screen from what the container loaded and opened: `rows` is null while the viewing key is
 * locked or the records are opening, and then no figure is shown.
 */
export function BooksScreen({
  books,
  payments,
  rows,
  unverified,
  problem,
  onReconcile,
  side,
}: {
  books: BooksView;
  payments: BooksPaymentView[];
  rows: LedgerRow[] | null;
  unverified: number;
  problem: string | null;
  onReconcile: (paymentId: string, status: "matched" | "needs_receipt") => Promise<void>;
  /** The wallet and viewing key cards, which need the page's confidential session. */
  side?: ReactNode;
}) {
  const asset = useAssetWords();
  const formatUsdc = (base: bigint) => formatAmount(base, asset);
  const orgName = books.org.displayName;
  const grant = books.grants[0];
  const [month, setMonth] = useState<string | null>(null);
  const [chip, setChip] = useState<LedgerFilter["chip"]>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<{ tone: "done" | "problem"; text: string } | null>(null);

  const months = rows ? monthsOf(rows) : [];
  const activeMonth = month && months.includes(month) ? month : (months.at(-1) ?? null);
  const inRange = rows ? rows.filter((row) => months.includes(row.month)) : [];
  const shown = rows ? filterRows(rows, { month: activeMonth, chip, search }) : [];
  const totals = monthTotals(inRange, months);
  const categories = categoryTotals(inRange);
  const rangeTotal = sum(inRange);
  const needs = payments.filter(
    (payment) => (payment.reconciliation?.status ?? "needs_receipt") === "needs_receipt",
  );
  const present = rows ? [...new Set(rows.map((row) => row.category))] : [];
  const detail = rows?.find((row) => row.id === selected) ?? null;
  const expiry = grant ? expiryWords(grant.expiresAt) : "No expiry";
  const readOnly =
    expiry === "No expiry"
      ? "read only, no expiry"
      : `read only ${expiry.charAt(0).toLowerCase()}${expiry.slice(1)}`;
  const granter = grant
    ? (grant.grantedBy.name ?? shortWallet(grant.grantedBy.wallet))
    : shortWallet(books.ownerWallet);

  async function exportCsv() {
    if (!grant || !rows) return;
    setExporting(true);
    setExported(null);
    try {
      // AC-11.4: the event first, so the owner sees every export; then the file, made here.
      await callApi(`/api/orgs/${books.org.id}/exports`, {
        method: "POST",
        body: {
          grantId: grant.id,
          rows: shown.length,
          month: activeMonth,
          category: chip && chip !== "needs_receipt" ? chip : null,
          needsReceipt: chip === "needs_receipt",
          searched: search.trim() !== "",
        },
      });
      const url = URL.createObjectURL(
        new Blob([ledgerCsv(shown, asset.symbol)], { type: "text/csv" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `books-${activeMonth ?? "all"}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setExported({
        tone: "done",
        text: `Exported ${shown.length} ${shown.length === 1 ? "row" : "rows"} to CSV in this tab. ${orgName} sees the export in its access log.`,
      });
    } catch (error) {
      setExported({
        tone: "problem",
        text:
          error instanceof ApiCallError
            ? `The export was not made: ${error.message}`
            : "The export was not made. Try again.",
      });
    } finally {
      setExporting(false);
    }
  }

  const unlockToSee = <span className={styles.sealed}>Unlock to see</span>;
  return (
    <>
      <PageHeader
        overline={`${orgName}, ${readOnly}`}
        title="Books"
        actions={
          <div className={styles.actions}>
            {months.length > 0 ? (
              <div className={styles.seg} role="group" aria-label="Month">
                {months.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    className={entry === activeMonth ? styles.on : undefined}
                    aria-pressed={entry === activeMonth}
                    onClick={() => setMonth(entry)}
                  >
                    {monthLabel(entry)}
                  </button>
                ))}
              </div>
            ) : null}
            <Button
              variant="dark"
              disabled={!rows || !grant || shown.length === 0 || exporting}
              onClick={() => void exportCsv()}
              data-testid="export-csv"
            >
              {exporting ? "Exporting…" : "Export CSV"}
            </Button>
          </div>
        }
      />
      <div className={styles.page}>
        <Card className={styles.s12} data-testid="scope-banner">
          <p className={styles.banner}>
            <span className={styles.bannerIcon} aria-hidden="true">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </span>
            <span>
              Shared by <b>{granter}</b> ·{" "}
              {grant ? scopeWords(grant.scope, grant.periodFrom, grant.periodTo) : "Every amount"} ·{" "}
              {expiry} · Read only, never control of funds
            </span>
          </p>
          {exported ? (
            <p
              className={exported.tone === "done" ? notices.result : cards.problem}
              role={exported.tone === "done" ? "status" : "alert"}
              data-testid="export-result"
            >
              {exported.text}
            </p>
          ) : null}
        </Card>

        <Card tone="dark" className={styles.s5} data-testid="money-out">
          <div className={styles.cardHead}>
            <h3>Money out{months.length > 0 ? `, ${rangeLabel(months)}` : ""}</h3>
            <span className={styles.darkChip}>{rows ? "Decrypted for you" : "Sealed"}</span>
            <AssetBadge onDark />
          </div>
          <div className={styles.bigd}>
            {rows ? (
              <b className="num" data-testid="money-out-total">
                <Amount>{formatUsdc(rangeTotal)}</Amount>
              </b>
            ) : (
              unlockToSee
            )}
          </div>
          {rows && totals.length > 0 ? (
            <MonthBars
              totals={totals}
              selected={activeMonth}
              format={formatUsdc}
              testId="money-out-bar"
              // The design lays out a quarter, three months (step 3.7).
              slots={3}
            />
          ) : null}
        </Card>

        <Card className={styles.s4} data-testid="by-category">
          <span className={styles.label}>By category</span>
          {!rows ? (
            <p className={styles.empty}>Unlock to see</p>
          ) : categories.length === 0 ? (
            <p className={styles.empty}>No records yet.</p>
          ) : (
            categories.map((entry, index) => (
              <div key={entry.category} className={styles.bmr} data-testid="category-row">
                <div className={styles.bml}>
                  <span>{BOOKS_CATEGORY_LABEL[entry.category]}</span>
                  <b className="num">
                    <Amount>{formatUsdc(entry.total)}</Amount>
                  </b>
                </div>
                <div className={styles.bmb}>
                  <span
                    className={index === 1 ? styles.b2 : index >= 2 ? styles.b3 : undefined}
                    style={{
                      width: `${rangeTotal > 0n ? Number((entry.total * 1000n) / rangeTotal) / 10 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))
          )}
        </Card>

        <Card className={styles.s3} data-testid="reconciliation">
          <span className={styles.label}>Reconciliation</span>
          <div className={styles.bmv}>
            <b data-testid="needs-receipt-count">{needs.length}</b>
            <span>{needs.length === 1 ? "needs a receipt" : "need receipts"}</span>
          </div>
          <div className={styles.rec} aria-hidden="true">
            {payments.map((payment) => (
              <i
                key={payment.id}
                className={
                  (payment.reconciliation?.status ?? "needs_receipt") === "needs_receipt"
                    ? styles.am
                    : undefined
                }
              />
            ))}
          </div>
          <div className={cards.actions}>
            <Button
              variant="line"
              size="sm"
              disabled={!rows || needs.length === 0}
              onClick={() => setChip("needs_receipt")}
            >
              Show them
            </Button>
          </div>
        </Card>

        <Card className={styles.s12} data-testid="ledger">
          <div className={styles.tool}>
            <div className={styles.toolLeft}>
              <h2>Ledger</h2>
              {rows ? (
                <div className={styles.chipf} role="group" aria-label="Filter">
                  {[
                    { key: null, label: "All" },
                    ...present.map((category) => ({
                      key: category,
                      label: BOOKS_CATEGORY_LABEL[category],
                    })),
                    { key: "needs_receipt" as const, label: "Needs receipt" },
                  ].map((entry) => (
                    <button
                      key={entry.key ?? "all"}
                      type="button"
                      className={entry.key === chip ? styles.on : undefined}
                      aria-pressed={entry.key === chip}
                      onClick={() => setChip(entry.key)}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            {rows ? (
              <input
                className={styles.search}
                type="search"
                aria-label="Search the ledger"
                placeholder="Search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            ) : null}
          </div>
          {problem ? (
            <p className={cards.problem} role="alert">
              {problem}
            </p>
          ) : null}
          {unverified > 0 ? (
            <p className={cards.warning} role="alert" data-testid="books-unverified">
              {unverified === 1
                ? `1 record did not verify against ${orgName}'s signature, so it was not opened.`
                : `${unverified} records did not verify against ${orgName}'s signature, so they were not opened.`}
            </p>
          ) : null}
          {!rows ? (
            <p className={notices.info} data-testid="books-locked">
              {payments.length === 0
                ? `${orgName} has not shared any record with you yet.`
                : `${payments.length} ${payments.length === 1 ? "record is" : "records are"} sealed to your viewing key. Unlock it below to read them in this tab.`}
            </p>
          ) : shown.length === 0 ? (
            <p className={styles.ledgerEmpty} data-testid="ledger-empty">
              {rows.length === 0
                ? `${orgName} has not shared any record with you yet.`
                : "No record matches these filters."}
            </p>
          ) : (
            <div className={styles.scroll}>
              <Table>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Description</Th>
                    <Th>Category</Th>
                    <Th>Reconciliation</Th>
                    <Th align="right">Amount</Th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <tr
                      key={row.id}
                      className={`${styles.row} ${row.id === selected ? styles.sel : ""}`}
                      onClick={() => setSelected(row.id)}
                      data-testid="ledger-row"
                      data-kind={row.kind}
                    >
                      <Td>
                        <span className={`num ${styles.muted}`}>{formatDate(row.date)}</span>
                      </Td>
                      <Td>
                        <span className={styles.person}>
                          <span className={styles.initial} aria-hidden="true">
                            {initial(row.counterparty)}
                          </span>
                          <span>
                            <b>{row.counterparty}</b>
                            <small>{row.memo ?? row.payment.run?.title ?? "No memo"}</small>
                          </span>
                        </span>
                      </Td>
                      <Td>
                        <Chip>{BOOKS_CATEGORY_LABEL[row.category]}</Chip>
                      </Td>
                      <Td>
                        <Chip tone={row.reconciliation === "matched" ? "green" : "amber"}>
                          {row.reconciliation === "matched" ? "Matched" : "Needs receipt"}
                        </Chip>
                      </Td>
                      <Td align="right">
                        <span className="num" data-testid="ledger-amount">
                          <Amount>{formatUsdc(row.amount)}</Amount>
                        </span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card>

        {side}
      </div>
      <PaymentDrawer
        row={detail}
        orgName={orgName}
        onClose={() => setSelected(null)}
        onReconcile={onReconcile}
      />
    </>
  );
}

const SCREENING_WORDS: Record<NonNullable<BooksPaymentView["screening"]>, string> = {
  clear: "Recipient clear",
  hit: "Recipient on the screening list",
  error: "Screening could not run",
};

function PaymentDrawer({
  row,
  orgName,
  onClose,
  onReconcile,
}: {
  row: LedgerRow | null;
  orgName: string;
  onClose: () => void;
  onReconcile: (paymentId: string, status: "matched" | "needs_receipt") => Promise<void>;
}) {
  const asset = useAssetWords();
  const formatUsdc = (base: bigint) => formatAmount(base, asset);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const matched = row?.reconciliation === "matched";

  async function mark() {
    if (!row) return;
    setBusy(true);
    setProblem(null);
    try {
      await onReconcile(row.id, matched ? "needs_receipt" : "matched");
    } catch (error) {
      setProblem(
        error instanceof ApiCallError ? error.message : "The status could not be saved. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const chain = row?.payment.chain ?? null;
  return (
    <Drawer
      open={row !== null}
      title={row?.counterparty ?? "Payment detail"}
      subtitle={row?.memo ?? row?.payment.run?.title ?? "No memo"}
      onClose={() => {
        setProblem(null);
        onClose();
      }}
      footer={
        row ? (
          <Button
            variant={matched ? "line" : "dark"}
            disabled={busy}
            onClick={() => void mark()}
            data-testid="mark-reconciled"
          >
            {busy ? "Saving…" : matched ? "Mark as needing a receipt" : "Mark reconciled"}
          </Button>
        ) : null
      }
    >
      {row ? (
        <div className={styles.drawerBody} data-testid="payment-detail">
          <small className={styles.muted}>Amount</small>
          <div className={`${styles.big2} num`}>
            <Amount>{formatUsdc(row.amount)}</Amount>
          </div>
          <div className={styles.chips}>
            <Chip tone="blue">Decrypted with your key</Chip>
            <Chip tone={matched ? "green" : "amber"} data-testid="detail-reconciliation">
              {matched ? "Matched" : "Needs receipt"}
            </Chip>
          </div>
          <div className={styles.fieldLabel}>What each party sees</div>
          <div className={styles.anat}>
            <div>
              <span>From, to</span>
              <span className="mono">
                {chain
                  ? `${shortWallet(chain.from)} to ${shortWallet(chain.to)}`
                  : "Not indexed yet"}
              </span>
              <Chip>Public</Chip>
            </div>
            <div>
              <span>Date</span>
              <span>{formatDate(row.date)}</span>
              <Chip>Public</Chip>
            </div>
            <div>
              <span>Amount</span>
              <span className="num">
                <Amount>{formatUsdc(row.amount)}</Amount>
              </span>
              <Chip tone="blue">Sealed</Chip>
            </div>
            <div>
              <span>Memo</span>
              <span>{row.memo ?? "No memo"}</span>
              <Chip tone="blue">Sealed</Chip>
            </div>
            <div>
              <span>Screening</span>
              <span>
                {row.payment.screening ? SCREENING_WORDS[row.payment.screening] : "Not recorded"}
              </span>
              <Chip tone="green">Checked</Chip>
            </div>
          </div>
          <div className={styles.fieldLabel}>Audit trail</div>
          <div className={styles.log}>
            {chain ? (
              <div className={styles.logEntry}>
                <span className={styles.logDot} aria-hidden="true" />
                <div>
                  <b>Sealed and settled on Solana</b>
                  <small>
                    {formatDate(chain.blockTime ?? row.date)}, tx{" "}
                    <span className="mono">{chain.signature.slice(0, 8)}…</span>
                  </small>
                </div>
              </div>
            ) : null}
            {row.payment.approvedBy ? (
              <div className={styles.logEntry}>
                <span className={styles.logDot} aria-hidden="true" />
                <div>
                  <b>
                    Approved by{" "}
                    {row.payment.approvedBy.name ?? shortWallet(row.payment.approvedBy.wallet)}
                  </b>
                  <small>
                    Owner of {orgName}, {formatDate(row.payment.approvedBy.at)}
                  </small>
                </div>
              </div>
            ) : null}
            <div className={styles.logEntry}>
              <span className={styles.logDot} aria-hidden="true" />
              <div>
                <b>Decrypted by you</b>
                <small>Today, on this device</small>
              </div>
            </div>
          </div>
          {problem ? (
            <p className={cards.problem} role="alert">
              {problem}
            </p>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
