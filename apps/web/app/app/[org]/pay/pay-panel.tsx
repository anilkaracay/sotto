"use client";

// My pay (F-12, AC-12.1, AC-12.2; step 2.6), growing the recipient's pay page of step 1.10, on the
// design's My pay screen where data exists (13 A49): for each organization that pays the recipient,
// grouped (the page's own first), the latest payslip (net, and gross and tax withheld when the payroll
// CSV gave them, and who can read it), the net pay of the last 6 months, the payslips, and "What your
// colleagues see" (the organization's transfers into the recipient's account as the chain shows them,
// never an amount); then the recipient's balances and withdraw (F-09). A record of category payroll
// reads as a payslip; any other category as a payment from the organization, with the amount
// received and no gross or tax, and both kinds share one list, each row labelled (13 A49). Every amount is the recipient's
// own record, trusted only when its manifest names the organization, carries its owner's signature and
// lists the item for this recipient (I-9), and opened with the viewing key in this tab; the public
// view comes from chain_activity through the pay endpoint. Nothing opens before the unlock, and no
// figure shows while locked.
import { formatTokenAmount } from "@sotto/sdk/confidential/public";
import type { DisclosurePayloadV1 } from "@sotto/sdk/disclosure";
import { Button, Card, Chip, initials } from "@sotto/ui";
import { address, fetchEncodedAccount } from "@solana/kit";
import { useEffect, useState } from "react";
import { BOOKS_CATEGORY_LABEL } from "../../../../lib/books.ts";
import { callApi } from "../../../../lib/client/api.ts";
import { openDisclosures } from "../../../../lib/client/disclosures.ts";
import { browserRpc } from "../../../../lib/client/rpc.ts";
import { formatDate, shortWallet } from "../../../../lib/format.ts";
import { assetWords, formatAmount } from "../../../../lib/asset-words.ts";
import {
  isPayslip,
  lastMonths,
  netByMonth,
  payslipsOf,
  payslipTitle,
  readersWords,
  type Payslip,
} from "../../../../lib/pay.ts";
import { payslipPdf } from "../../../../lib/payslip-pdf.ts";
import type { DisclosureItemView, ManifestView } from "../../../../lib/server/disclosures.ts";
import type { PayView } from "../../../../lib/server/pay.ts";
import { BalancesSection } from "../../_components/confidential/balances-section.tsx";
import cards from "../../_components/confidential/cards.module.css";
import extra from "../../_components/confidential/confidential.module.css";
import {
  ConfidentialProvider,
  useConfidential,
  type AvailableNetwork,
} from "../../_components/confidential/context.tsx";
import { KeysCard, WalletCard } from "../../_components/confidential/keys.tsx";
import { NetworkBanner } from "../../_components/confidential/network-banner.tsx";
import { PausedNote } from "../../_components/confidential/paused-note.tsx";
import { StepError, useSend } from "../../_components/confidential/use-send.ts";
import { WithdrawForm } from "../../_components/confidential/withdraw.tsx";
import { useKeySession } from "../../_components/key-session.tsx";
import { useAssetWords } from "../../_components/asset.tsx";
import { DevnetTestBadge } from "../../_components/devnet-badge.tsx";
import { MonthBars } from "../../_components/month-bars.tsx";
import { SkyArt } from "../../_components/sky-art.tsx";
import styles from "./pay.module.css";
import { Amount, WithAmounts } from "../../_components/privacy.tsx";

const DECIMALS = 6;

export function PayPanel(props: {
  wallet: string;
  userId: string;
  orgId: string;
  /** Every active organization that pays the recipient, this page's first. */
  orgs: { orgId: string; orgName: string }[];
  network: AvailableNetwork;
}) {
  return (
    <ConfidentialProvider wallet={props.wallet} orgId={props.orgId} network={props.network}>
      <div className={cards.grid}>
        <NetworkBanner check={props.network.check} label={props.network.label} />
        {props.orgs.map((org) => (
          <PayGroup
            key={org.orgId}
            orgId={org.orgId}
            orgName={org.orgName}
            userId={props.userId}
            grouped={props.orgs.length > 1}
          />
        ))}
        <BalancesSection />
        <Card data-testid="withdraw-card">
          <WithdrawTitle />
          <ApplyPending />
          <WithdrawForm />
        </Card>
        <div className={styles.side}>
          <WalletCard />
          <KeysCard />
        </div>
      </div>
    </ConfidentialProvider>
  );
}

function WithdrawTitle() {
  const asset = useAssetWords();
  return <h2 className={cards.cardTitle}>Withdraw to {asset.symbol}</h2>;
}

/** 06 section 4, step 3: a pending balance is applied from fresh account state, with the keys. */
/** Exported for the component tests (F-19). */
export function ApplyPending() {
  const { vault, data, network, blocked } = useConfidential();
  const sending = useSend();
  const pending = data.confidential.kind === "decrypted" ? data.confidential.pending : 0n;
  if (pending <= 0n && !sending.done) return null;
  const token = data.wusdcAccount;
  return (
    <div className={styles.apply}>
      {pending > 0n ? (
        <p className={cards.lead}>
          <Amount>
            {formatTokenAmount(pending, network.decimals ?? DECIMALS)} {network.asset.wrappedSymbol}
          </Amount>{" "}
          is in your pending balance. Apply it to your available balance to use it.
        </p>
      ) : null}
      {pending > 0n ? (
        <div className={cards.actions}>
          <Button
            variant="line"
            disabled={
              !sending.canSend || sending.busy !== null || !vault.unlocked || !token || !!blocked
            }
            onClick={() => {
              if (!token) return;
              void sending.send({
                busy: "Applying your pending balance…",
                done: "Applied your pending balance to your available balance.",
                build: async () => {
                  const account = await fetchEncodedAccount(browserRpc(), address(token), {
                    commitment: "confirmed",
                  });
                  if (!account.exists)
                    throw new StepError(
                      `Your ${network.asset.wrappedSymbol} account does not exist.`,
                    );
                  return [
                    await vault.worker().applyInstruction(token, new Uint8Array(account.data)),
                  ];
                },
              });
            }}
          >
            Apply pending balance
          </Button>
          <PausedNote />
        </div>
      ) : null}
      {sending.busy ? (
        <div className={extra.progress} role="status">
          <WithAmounts>{sending.busy}</WithAmounts>
        </div>
      ) : null}
      {sending.done ? (
        <div className={extra.result} role="status" data-testid="apply-done">
          <WithAmounts>{sending.done.text}</WithAmounts> Transaction{" "}
          <span className="mono">{sending.done.signature.slice(0, 12)}…</span>
        </div>
      ) : null}
      {sending.problem ? (
        <p className={cards.problem} role="alert">
          <WithAmounts>{sending.problem}</WithAmounts>
        </p>
      ) : null}
    </div>
  );
}

type Records = { items: DisclosureItemView[]; manifests: ManifestView[] };

/** One organization's pay: its view from the server, the recipient's records, opened in the tab. */
function PayGroup({
  orgId,
  orgName,
  userId,
  grouped,
}: {
  orgId: string;
  orgName: string;
  userId: string;
  grouped: boolean;
}) {
  const { wallet } = useConfidential();
  const { session, viewing } = useKeySession();
  const unlocked = viewing?.wallet === wallet;
  const [loaded, setLoaded] = useState<{ pay: PayView; records: Records } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [opened, setOpened] = useState<{
    payloads: DisclosurePayloadV1[];
    unverified: number;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      callApi<PayView>(`/api/orgs/${orgId}/pay`),
      callApi<Records>(`/api/orgs/${orgId}/disclosures`),
    ]).then(
      ([pay, records]) => {
        if (!cancelled) {
          setLoaded({
            pay,
            records: {
              items: records.items.filter(
                (item) => item.kind === "payment" || item.kind === "payroll_line",
              ),
              manifests: records.manifests,
            },
          });
        }
      },
      () => {
        if (!cancelled) setProblem("Your payments could not be loaded. Try again.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [orgId, attempt]);

  // While the tab holds the viewing key the records open for this page only; locked, none stay open.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!loaded || !unlocked) {
        if (!cancelled) setOpened(null);
        return;
      }
      const items = await openDisclosures({
        orgId,
        ownerWallet: loaded.pay.ownerWallet,
        viewerUserId: userId,
        items: loaded.records.items,
        manifests: loaded.records.manifests,
        open: (ciphertext) => session.openWorker().openSealed(ciphertext),
      });
      if (!cancelled) {
        setOpened({
          payloads: items.flatMap((item) => (item.state === "opened" ? [item.payload] : [])),
          unverified: items.filter((item) => item.state === "unverified").length,
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, unlocked, session, orgId, userId]);

  return (
    <PayGroupView
      orgName={orgName}
      grouped={grouped}
      state={
        problem
          ? { kind: "error", message: problem }
          : !loaded
            ? { kind: "loading" }
            : {
                kind: "loaded",
                pay: loaded.pay,
                sealed: loaded.records.items.length,
                slips: opened ? payslipsOf(opened.payloads, loaded.pay) : null,
                unverified: opened?.unverified ?? 0,
              }
      }
      now={new Date()}
      onRetry={() => {
        setProblem(null);
        setLoaded(null);
        setAttempt((value) => value + 1);
      }}
    />
  );
}

export type PayGroupState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "loaded";
      pay: PayView;
      /** How many records the recipient holds, before they open. */
      sealed: number;
      /** The payslips once opened in the tab; null while locked or opening. */
      slips: Payslip[] | null;
      unverified: number;
    };

/** AC-12.3: the payslip PDF, made in this tab from the opened record and saved by the browser. */
function downloadPayslip(orgName: string, pay: PayView, slip: Payslip) {
  const pdf = payslipPdf({
    orgName,
    asset: assetWords(pay.org.asset),
    recipientName: pay.recipient.displayName,
    roleTitle: pay.recipient.roleTitle,
    wallet: pay.recipient.wallet,
    slip,
  });
  const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${isPayslip(slip) ? "payslip" : "payment-receipt"}-${slip.date.slice(0, 10)}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

/** The group from what the container loaded and opened: loading, error, locked and opened states. */
export function PayGroupView({
  orgName,
  grouped,
  state,
  now,
  onRetry,
}: {
  orgName: string;
  grouped: boolean;
  state: PayGroupState;
  now: Date;
  onRetry: () => void;
}) {
  const heading = grouped ? (
    <h2 className={styles.groupHead} data-testid="pay-group-name">
      From {orgName}
    </h2>
  ) : null;
  if (state.kind !== "loaded") {
    return (
      <section className={`${styles.wide} ${styles.group}`} data-testid="pay-group">
        {heading}
        <Card className={styles.s12}>
          {state.kind === "error" ? (
            <div className={cards.problem} role="alert">
              <p>{state.message}</p>
              <div className={cards.actions}>
                <Button variant="line" size="sm" onClick={onRetry}>
                  Try again
                </Button>
              </div>
            </div>
          ) : (
            <p className={styles.empty} role="status">
              Reading your payments…
            </p>
          )}
        </Card>
      </section>
    );
  }
  const { pay, slips, sealed, unverified } = state;
  // Each group in its own organization's asset (step 4.3): one recipient may be paid in USDC and devUSD.
  const asset = assetWords(pay.org.asset);
  const formatUsdc = (base: bigint) => formatAmount(base, asset);
  const latest = slips?.[0] ?? null;
  const latestIsPayslip = latest ? isPayslip(latest) : true;
  const payslipCount = slips?.filter(isPayslip).length ?? 0;
  const listTitle =
    !slips || payslipCount === slips.length
      ? "Payslips"
      : payslipCount === 0
        ? "Payments"
        : "Payslips and payments";
  const months = lastMonths(now);
  const history = slips ? netByMonth(slips, months) : [];
  const litMonth = slips?.find((slip) => months.includes(slip.month))?.month ?? null;
  const account = pay.tokenAccount ?? pay.recipient.wallet;
  return (
    <section className={`${styles.wide} ${styles.group}`} data-testid="pay-group">
      {heading}
      <section className={`${styles.s7} ${styles.sky}`} data-testid="payslip-card">
        <SkyArt className={styles.skyArt} />
        <div className={styles.skyText}>
          <h3>
            {!latest
              ? "Your pay"
              : latestIsPayslip
                ? `${payslipTitle(latest)} pay`
                : payslipTitle(latest)}
          </h3>
          <p>
            {latest && !latestIsPayslip ? (
              <span className={styles.from}>Payment from {orgName}</span>
            ) : null}
            {latest
              ? `Paid ${formatDate(latest.date)} to ${shortWallet(pay.recipient.wallet)}`
              : sealed === 0
                ? `No payment from ${orgName} yet.`
                : `${sealed === 1 ? "1 payment is" : `${sealed} payments are`} sealed to your viewing key. Unlock your keys to read ${sealed === 1 ? "it" : "them"} in this tab.`}
          </p>
        </div>
        {latest ? (
          <div className={styles.slip}>
            <div className={styles.sg1}>
              <span>{latestIsPayslip ? "Net pay" : "Amount received"}</span>
              <Chip tone="green" check>
                Paid
              </Chip>
            </div>
            <b className={`${styles.sgb} num`} data-testid="payslip-net">
              <Amount>{formatUsdc(latest.net)}</Amount>
            </b>
            {latestIsPayslip && latest.gross !== null && latest.tax !== null ? (
              <div className={styles.sg2}>
                <div>
                  <small>Gross</small>
                  <b className="num" data-testid="payslip-gross">
                    <Amount>{formatUsdc(latest.gross)}</Amount>
                  </b>
                </div>
                <div>
                  <small>Tax withheld</small>
                  <b className="num" data-testid="payslip-tax">
                    <Amount>({formatUsdc(latest.tax)})</Amount>
                  </b>
                </div>
              </div>
            ) : null}
            <p className={styles.sg3}>
              {/* The design's stacked avatars of who can read it, as initials (step 3.7). */}
              <span className={styles.readers} aria-hidden="true">
                {[pay.recipient.displayName, orgName, ...latest.readers]
                  .slice(0, 4)
                  .map((name, index) => (
                    <span key={`${name}:${index}`} className={styles.reader}>
                      {initials(name)}
                    </span>
                  ))}
              </span>
              <span data-testid="payslip-readers">{readersWords(orgName, latest.readers)}</span>
            </p>
          </div>
        ) : null}
      </section>

      <Card tone="dark" className={styles.s5} data-testid="pay-history">
        <div className={styles.cardHead}>
          <h3>Last 6 months</h3>
          <span className={styles.darkChip}>
            {slips && payslipCount < slips.length ? "Received" : "Net"}, {asset.symbol}
          </span>
          <DevnetTestBadge asset={asset} onDark />
        </div>
        {slips ? (
          <MonthBars totals={history} selected={litMonth} format={formatUsdc} testId="pay-bar" />
        ) : (
          <p className={styles.darkEmpty}>Unlock to see</p>
        )}
      </Card>

      <Card className={styles.s7} data-testid="received-card">
        <div className={styles.head}>
          <h3>{listTitle}</h3>
          <small className={styles.muted}>From {orgName}</small>
        </div>
        {unverified > 0 ? (
          <p className={cards.warning} role="alert">
            {unverified === 1
              ? `1 payment record did not verify against ${orgName}'s signature, so it was not opened.`
              : `${unverified} payment records did not verify against ${orgName}'s signature, so they were not opened.`}
          </p>
        ) : null}
        {sealed === 0 ? (
          <p className={styles.empty} data-testid="received-empty">
            No payments yet. When {orgName} pays you, the payment and its details appear here, for
            you to read in this tab.
          </p>
        ) : !slips ? (
          <p className={cards.lead} data-testid="received-locked">
            {sealed === 1 ? "1 payment is" : `${sealed} payments are`} sealed to your viewing key.
            Unlock your keys to read {sealed === 1 ? "it" : "them"} in this tab.
          </p>
        ) : (
          <div className={styles.list}>
            {slips.map((slip) => (
              <div
                key={slip.id}
                className={styles.slipRow}
                data-testid="received-row"
                data-state="opened"
                data-kind={slip.kind}
                data-label={isPayslip(slip) ? "payslip" : "payment"}
              >
                <span className={styles.slipIcon} aria-hidden="true">
                  {/* The design's document for a payslip; an arrow in for a payment (step 3.7). */}
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {isPayslip(slip) ? (
                      <path d="M7 3h7l4 4v14H7z M14 3v4h4 M10 12h5 M10 16h5" />
                    ) : (
                      <path d="M17 7L7 17 M15 17H7V9" />
                    )}
                  </svg>
                </span>
                <div>
                  <b>{payslipTitle(slip)}</b>
                  <small data-testid="received-label">
                    {isPayslip(slip)
                      ? `Payslip · Paid ${formatDate(slip.date)}${slip.kind === "payroll_line" && slip.memo ? ` · ${slip.memo}` : ""}`
                      : `Payment from ${orgName} · Paid ${formatDate(slip.date)} · ${BOOKS_CATEGORY_LABEL[slip.category]}`}
                  </small>
                </div>
                <span className={`${styles.amount} num`} data-testid="received-amount">
                  <Amount>{formatUsdc(slip.net)}</Amount>
                </span>
                <Button
                  variant="line"
                  size="sm"
                  onClick={() => downloadPayslip(orgName, pay, slip)}
                  data-testid="payslip-pdf"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
                  </svg>
                  PDF
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className={styles.s5} data-testid="colleagues-view">
        <span className={styles.label}>What your colleagues see</span>
        <p className={styles.today}>
          A payment from {orgName} to your account, and when. <b>Never the amount.</b>
        </p>
        {pay.chain.length === 0 ? (
          <p className={styles.empty}>Nothing on Solana yet.</p>
        ) : (
          <div className={styles.pub}>
            {pay.chain.slice(0, 6).map((row) => (
              <div key={row.signature} className={styles.pubRow} data-testid="colleagues-row">
                <span className="mono">{shortWallet(account)}</span>
                <span>{row.blockTime ? formatDate(row.blockTime) : "Time not known"}</span>
                <span className={styles.bar} role="img" aria-label="Amount sealed" />
              </div>
            ))}
          </div>
        )}
      </Card>
    </section>
  );
}
