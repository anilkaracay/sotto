"use client";

// The payment page's client part (F-06, AC-06.1 to AC-06.5; step 1.9). The owner picks a recipient
// whose account is ready, enters the amount, a memo and a category; the page seals them to the
// owner's own viewing key (the payment's private blob), creates the draft, asks the server to
// authorize it (the recipient's account read from chain now, screening, approvals, the proof
// program), then runs the transfer in this tab (payment-run.ts) and shows each step. A failed step is
// named, its proof accounts are closed and the payment can be tried again; the recent payments list
// offers that retry once the tab holds the viewing key that opens the amount.
import { formatTokenAmount, parseTokenAmount } from "@sotto/sdk/confidential/public";
import { verifyViewKeyRegistration } from "@sotto/sdk/keys/public";
import {
  Button,
  Card,
  Chip,
  Field,
  FieldActions,
  FieldGrid,
  Input,
  Select,
  Table,
  Td,
  Th,
} from "@sotto/ui";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiCallError, callApi } from "../../../../../lib/client/api.ts";
import { GRANT_COPIES_MISSING } from "../../../../../lib/client/records.ts";
import { describeTransactionError } from "../../../../../lib/client/transactions.ts";
import { CryptoWorkerError } from "../../../../../lib/crypto-worker/client.ts";
import { formatDate, shortWallet } from "../../../../../lib/format.ts";
import {
  canRetry,
  CATEGORY_LABEL,
  memoProblem,
  parsePaymentPrivate,
  PAYMENT_CATEGORIES,
  paymentStatusChip,
  type PaymentCategory,
  type PaymentPrivate,
} from "../../../../../lib/payment.ts";
import { payability, READINESS_LABEL, type Readiness } from "../../../../../lib/recipient.ts";
import type { PaymentView } from "../../../../../lib/server/payments.ts";
import cards from "../../../_components/confidential/cards.module.css";
import notice from "../../../_components/confidential/confidential.module.css";
import {
  ConfidentialProvider,
  useConfidential,
  type AvailableNetwork,
} from "../../../_components/confidential/context.tsx";
import { KeysCard, WalletCard } from "../../../_components/confidential/keys.tsx";
import { PausedNote } from "../../../_components/confidential/paused-note.tsx";
import { useKeySession } from "../../../_components/key-session.tsx";
import styles from "./payments.module.css";
import { runPayment, type PaymentRunOutcome, type ViewerKeyRecord } from "./payment-run.ts";
import { Amount, WithAmounts } from "../../../_components/privacy.tsx";
import { formatAmount } from "../../../../../lib/asset-words.ts";
import { AssetBadge, useAssetWords } from "../../../_components/asset.tsx";

export type PayableRecipient = {
  id: string;
  displayName: string;
  wallet: string;
  readiness: Readiness;
  privateBlob: string | null;
  viewerKey: ViewerKeyRecord | null;
};

const DECIMALS = 6;
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

type Progress = { busy: string | null; problem: string | null; done: string | null };
const IDLE: Progress = { busy: null, problem: null, done: null };

export function PaymentsPanel(props: {
  wallet: string;
  orgId: string;
  network: AvailableNetwork;
  recipients: PayableRecipient[];
  payments: PaymentView[];
  ownerKey: ViewerKeyRecord | null;
}) {
  return (
    <ConfidentialProvider
      wallet={props.wallet}
      orgId={props.orgId}
      network={props.network}
      readAccount={false}
    >
      <div className={cards.grid}>
        <PayCard recipients={props.recipients} ownerKey={props.ownerKey} />
        <div className={styles.side}>
          <WalletCard />
          <KeysCard />
        </div>
        <PaymentsTable
          payments={props.payments}
          recipients={props.recipients}
          ownerKey={props.ownerKey}
        />
      </div>
    </ConfidentialProvider>
  );
}

/** The part both the form and the retry share: authorize, run, and follow the settlement. */
function usePaymentAttempt(ownerKey: ViewerKeyRecord | null) {
  const { orgId, network, connected, vault } = useConfidential();
  const router = useRouter();
  const [progress, setProgress] = useState<Progress>(IDLE);

  async function attempt(
    paymentId: string,
    recipient: PayableRecipient,
    secret: PaymentPrivate,
  ): Promise<void> {
    if (!connected || !ownerKey || !network.wrappedMint) return;
    setProgress({
      busy: "Checking the recipient's account, screening and approvals…",
      problem: null,
      done: null,
    });
    let authorized: PaymentView;
    try {
      authorized = (
        await callApi<{ payment: PaymentView }>(
          `/api/orgs/${orgId}/payments/${paymentId}/authorize`,
          { method: "POST" },
        )
      ).payment;
    } catch (error) {
      setProgress({
        busy: null,
        problem:
          error instanceof ApiCallError ? error.message : "The payment could not be authorized.",
        done: null,
      });
      router.refresh();
      return;
    }
    const release = vault.hold();
    let outcome: PaymentRunOutcome;
    try {
      outcome = await runPayment({
        input: {
          orgId,
          paymentId,
          attemptNo: authorized.attempts.length + 1,
          amount: BigInt(secret.amount),
          memo: secret.memo,
          category: secret.category,
          recipient: {
            displayName: recipient.displayName,
            wallet: recipient.wallet,
            viewerKey: recipient.viewerKey,
          },
          owner: ownerKey,
          wrappedMint: network.wrappedMint,
          asset: network.asset,
        },
        connected,
        worker: vault.worker,
        onProgress: (busy) => setProgress({ busy, problem: null, done: null }),
      });
    } catch (error) {
      outcome = {
        kind: "failed",
        message:
          error instanceof CryptoWorkerError && error.code === "insufficient_balance"
            ? "Your available confidential balance is below this amount. Nothing was sent."
            : error instanceof CryptoWorkerError && error.code === "recipient_not_ready"
              ? "The recipient's account cannot receive a confidential transfer right now. Nothing was sent."
              : describeTransactionError(error, connected.info.name),
      };
    } finally {
      release();
    }
    if (outcome.kind === "failed") {
      setProgress({ busy: null, problem: outcome.message, done: null });
      router.refresh();
      return;
    }
    // The worker's confirm-executions job records the settlement; follow it for a minute.
    setProgress({ busy: "Waiting for Sotto to record the settlement…", problem: null, done: null });
    let status = "executing";
    for (let i = 0; i < 30 && status !== "settled"; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      status = (await callApi<{ payment: PaymentView }>(`/api/orgs/${orgId}/payments/${paymentId}`))
        .payment.status;
    }
    const amount = formatAmount(BigInt(secret.amount), network.asset);
    const record = outcome.disclosed.problem
      ? ` ${outcome.disclosed.problem}`
      : `${
          outcome.disclosed.recipient
            ? ` The payment record is saved, encrypted for you and ${recipient.displayName}.`
            : ` The payment record is saved, encrypted for you; ${recipient.displayName} has no viewing key yet.`
        }${outcome.disclosed.grantCopiesMissing ? ` ${GRANT_COPIES_MISSING}` : ""}`;
    const integrity = outcome.integrityOk
      ? ""
      : " Your new available balance does not match the amount, so Sotto logged an integrity alert.";
    setProgress({
      busy: null,
      problem: null,
      done:
        status === "settled"
          ? `Paid ${amount} to ${recipient.displayName}. Settled onchain (transaction ${outcome.transferSignature.slice(0, 12)}…).${record}${integrity}`
          : `Sent ${amount} to ${recipient.displayName}; the transfer is finalized onchain (transaction ${outcome.transferSignature.slice(0, 12)}…), and Sotto has not recorded the settlement yet.${record}${integrity}`,
    });
    router.refresh();
  }

  return { progress, setProgress, attempt };
}

function Outcome({ progress }: { progress: Progress }) {
  return (
    <>
      {progress.busy ? (
        <p className={notice.progress} role="status" data-testid="payment-progress">
          <WithAmounts>{progress.busy}</WithAmounts>
        </p>
      ) : null}
      {progress.done ? (
        <p className={notice.result} role="status" data-testid="payment-done">
          <WithAmounts>{progress.done}</WithAmounts>
        </p>
      ) : null}
      {progress.problem ? (
        <p className={cards.problem} role="alert" data-testid="payment-problem">
          <WithAmounts>{progress.problem}</WithAmounts>
        </p>
      ) : null}
    </>
  );
}

/** Exported for the component tests (F-19). */
export function PayCard({
  recipients,
  ownerKey,
}: {
  recipients: PayableRecipient[];
  ownerKey: ViewerKeyRecord | null;
}) {
  const { wallet, orgId, vault, connected, blocked } = useConfidential();
  const asset = useAssetWords();
  const { viewing } = useKeySession();
  const id = useId();
  const { progress, setProgress, attempt } = usePaymentAttempt(ownerKey);
  const [recipientId, setRecipientId] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [category, setCategory] = useState<PaymentCategory>("supplier");
  const [errors, setErrors] = useState<Record<string, string>>({});
  // One idempotency key per payment the owner means to make (I-7): a second click reuses it.
  const intent = useRef<string>(crypto.randomUUID());
  const chosen = recipients.find((recipient) => recipient.id === recipientId) ?? null;
  const viewingOpen = viewing?.wallet === wallet;

  // The recipient's default amount prefills the amount once the tab can open it.
  useEffect(() => {
    if (!chosen?.privateBlob || !viewingOpen || amount !== "") return;
    let cancelled = false;
    void vault
      .worker()
      .openSealed(fromBase64(chosen.privateBlob))
      .then((value) => {
        const opened = value as { default_amount?: string | null };
        if (!cancelled && opened.default_amount) {
          setAmount(formatTokenAmount(BigInt(opened.default_amount), DECIMALS));
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Only when the recipient or the viewing key changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen?.id, viewingOpen]);

  // F-19: a confidential payment is paused while the proof program is unavailable.
  const ready = Boolean(connected?.signer && vault.unlocked && ownerKey) && !blocked;

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found: Record<string, string> = {};
    if (!chosen) found.recipient = "Choose a recipient";
    else if (chosen.readiness !== "ready")
      found.recipient = payability(chosen.readiness, asset).reason;
    const base = parseTokenAmount(amount, DECIMALS);
    if (base === null || base <= 0n) {
      found.amount = `Enter an amount above zero with at most ${DECIMALS} decimals`;
    }
    const memoIssue = memoProblem(memo.trim());
    if (memoIssue) found.memo = memoIssue;
    setErrors(found);
    if (Object.keys(found).length > 0 || !chosen || base === null || !ownerKey) return;
    const secret: PaymentPrivate = {
      v: 1,
      amount: base.toString(),
      memo: memo.trim() || null,
      category,
    };
    try {
      // I-8: the owner's viewing key is used only after its registration verifies.
      const publicKey = fromBase64(ownerKey.publicKey);
      const verified = await verifyViewKeyRegistration({
        wallet,
        publicKey,
        signature: fromBase64(ownerKey.signature),
      });
      if (!verified) {
        setProgress({
          busy: null,
          problem:
            "Your viewing key's registration does not verify for your wallet, so Sotto does not encrypt to it.",
          done: null,
        });
        return;
      }
      setProgress({ busy: "Creating the payment…", problem: null, done: null });
      const privateBlob = toBase64(await vault.worker().seal(publicKey, secret));
      const { payment } = await callApi<{ payment: PaymentView }>(`/api/orgs/${orgId}/payments`, {
        method: "POST",
        body: { recipientId: chosen.id, idempotencyKey: intent.current, privateBlob },
      });
      await attempt(payment.id, chosen, secret);
      intent.current = crypto.randomUUID();
    } catch (error) {
      setProgress({
        busy: null,
        problem:
          error instanceof ApiCallError
            ? error.message
            : describeTransactionError(error, connected?.info.name),
        done: null,
      });
    }
  }

  return (
    <Card data-testid="pay-card">
      <h2 className={cards.cardTitle}>Pay a recipient</h2>
      <p className={cards.lead}>
        A confidential {asset.wrappedSymbol} payment: the amount is encrypted onchain, and only you,
        the recipient and the people you share it with can read it. The amount, memo and category
        are encrypted in this tab to your viewing key; Sotto stores them sealed. <AssetBadge />
      </p>
      {!ownerKey ? (
        <p className={cards.warning} role="status">
          Create your viewing key on the Account setup page first: the payment is sealed to it.
        </p>
      ) : !vault.unlocked ? (
        <p className={cards.lead} role="status">
          Unlock your keys to pay: the proofs of a confidential transfer are made in this tab.
        </p>
      ) : null}
      <form onSubmit={submit} noValidate>
        <FieldGrid>
          <Field label="Recipient" htmlFor={`${id}-recipient`} error={errors.recipient} wide>
            <Select
              id={`${id}-recipient`}
              value={recipientId}
              onChange={(event) => {
                setRecipientId(event.target.value);
                setAmount("");
              }}
            >
              <option value="">Choose a recipient</option>
              {recipients.map((recipient) => (
                <option
                  key={recipient.id}
                  value={recipient.id}
                  disabled={recipient.readiness !== "ready"}
                >
                  {recipient.displayName} · {shortWallet(recipient.wallet)}
                  {recipient.readiness === "ready"
                    ? ""
                    : ` (${READINESS_LABEL[recipient.readiness]})`}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Amount (${asset.symbol})`} htmlFor={`${id}-amount`} error={errors.amount}>
            <Input
              id={`${id}-amount`}
              inputMode="decimal"
              data-amount=""
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-invalid={errors.amount ? true : undefined}
            />
          </Field>
          <Field label="Category" htmlFor={`${id}-category`}>
            <Select
              id={`${id}-category`}
              value={category}
              onChange={(event) => setCategory(event.target.value as PaymentCategory)}
            >
              {PAYMENT_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {CATEGORY_LABEL[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Memo"
            htmlFor={`${id}-memo`}
            hint="Optional, encrypted like the amount"
            error={errors.memo}
            wide
          >
            <Input
              id={`${id}-memo`}
              value={memo}
              onChange={(event) => setMemo(event.target.value)}
              aria-invalid={errors.memo ? true : undefined}
            />
          </Field>
          <FieldActions>
            <Button type="submit" variant="blue" disabled={!ready || progress.busy !== null}>
              {progress.busy ? "Paying…" : "Pay"}
            </Button>
          </FieldActions>
          <PausedNote />
        </FieldGrid>
      </form>
      <Outcome progress={progress} />
    </Card>
  );
}

function PaymentsTable({
  payments,
  recipients,
  ownerKey,
}: {
  payments: PaymentView[];
  recipients: PayableRecipient[];
  ownerKey: ViewerKeyRecord | null;
}) {
  const { wallet, vault, network, blocked } = useConfidential();
  const { session, viewing } = useKeySession();
  const unlocked = viewing?.wallet === wallet;
  const [opened, setOpened] = useState<Record<string, PaymentPrivate | "unreadable">>({});
  const { progress, attempt } = usePaymentAttempt(ownerKey);

  // While the tab holds the viewing key, the amounts open for this page only.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, PaymentPrivate | "unreadable"> = {};
      if (unlocked) {
        for (const payment of payments) {
          if (!payment.privateBlob) continue;
          try {
            const value = await session.openWorker().openSealed(fromBase64(payment.privateBlob));
            next[payment.id] = parsePaymentPrivate(value) ?? "unreadable";
          } catch {
            next[payment.id] = "unreadable";
          }
        }
      }
      if (!cancelled) setOpened(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, payments, session]);

  const amountCell = (payment: PaymentView) => {
    const value = opened[payment.id];
    if (!unlocked || value === undefined) return <span className={styles.muted}>Sealed</span>;
    if (value === "unreadable")
      return <span className={styles.muted}>Not readable with this key</span>;
    return (
      <span className="num" data-testid="payment-amount">
        <Amount>{formatAmount(BigInt(value.amount), network.asset)}</Amount>
      </span>
    );
  };

  return (
    <Card className={styles.tableCard} data-testid="payments-card">
      <div className={styles.head}>
        <h2 className={cards.cardTitle}>Recent payments</h2>
        {payments.length > 0 && !unlocked ? (
          <small className={styles.muted}>
            Amounts open in this tab once you unlock your keys.
          </small>
        ) : null}
      </div>
      <Outcome progress={progress} />
      {payments.length === 0 ? (
        <p className={styles.empty}>No payments yet.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Recipient</Th>
              <Th>Amount</Th>
              <Th className={styles.date}>Created</Th>
              <Th>Status</Th>
              <Th>Transaction</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => {
              const transfer = payment.attempts.at(-1)?.transferSignature ?? null;
              const secret = opened[payment.id];
              const recipient = recipients.find((r) => r.id === payment.recipientId) ?? null;
              return (
                <tr key={payment.id} data-testid="payment-row" data-status={payment.status}>
                  <Td>
                    <span className={styles.person}>
                      <b>{payment.recipient.displayName}</b>
                      <small className="mono">{shortWallet(payment.recipient.wallet)}</small>
                    </span>
                  </Td>
                  <Td>{amountCell(payment)}</Td>
                  <Td className={styles.date}>{formatDate(payment.createdAt)}</Td>
                  <Td>
                    <Chip
                      tone={paymentStatusChip(payment.status, payment.errorCode).tone}
                      check={paymentStatusChip(payment.status, payment.errorCode).tone === "green"}
                      data-testid="payment-status"
                    >
                      {paymentStatusChip(payment.status, payment.errorCode).label}
                    </Chip>
                  </Td>
                  <Td>
                    {transfer ? (
                      network.cluster === "devnet" ? (
                        <a
                          className="mono"
                          href={`https://explorer.solana.com/tx/${transfer}?cluster=devnet`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {transfer.slice(0, 12)}…
                        </a>
                      ) : (
                        <span className="mono">{transfer.slice(0, 12)}…</span>
                      )
                    ) : (
                      <span className={styles.muted}>None</span>
                    )}
                  </Td>
                  <Td align="right">
                    {canRetry(payment.status, payment.errorCode) && recipient ? (
                      <Button
                        variant="line"
                        size="sm"
                        disabled={
                          !vault.unlocked ||
                          !unlocked ||
                          !secret ||
                          secret === "unreadable" ||
                          progress.busy !== null ||
                          blocked !== null
                        }
                        onClick={() => {
                          if (secret && secret !== "unreadable") {
                            void attempt(payment.id, recipient, secret);
                          }
                        }}
                      >
                        Try again
                      </Button>
                    ) : null}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
