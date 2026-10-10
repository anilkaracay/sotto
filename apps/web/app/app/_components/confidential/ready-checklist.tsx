"use client";

// "Get ready to pay" (step 4.11, D-38): the one checklist that takes a new company on devnet from
// sign in to a wallet that can pay. It is on the dashboard and pinned at the top of Payments, Payroll
// and Proofs until it is complete. Six steps in order, exactly one in turn with one button; before a
// wallet prompt it says how many approvals to expect and what they are for; nothing is signed until
// the step's button is chosen (10 section 2). The logic is lib/ready.ts; this runs the steps with
// the same code as the Account setup page's cards.
import { parseTokenAmount, formatTokenAmount } from "@sotto/sdk/confidential/public";
import { Button, Card, Chip } from "@sotto/ui";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiCallError, callApi } from "../../../../lib/client/api.ts";
import { unlockKeys } from "../../../../lib/crypto-worker/unlock.ts";
import { explorerUrl } from "../../../../lib/explorer.ts";
import { shortWallet } from "../../../../lib/format.ts";
import {
  SOL_ELSEWHERE_AFTER,
  SOL_ELSEWHERE_BEFORE,
  SOLANA_FAUCET_NAME,
  SOLANA_FAUCET_URL,
} from "../../../../lib/first-run.ts";
import {
  firstPaymentHref,
  READY_DEFAULT_MOVE,
  READY_DONE_BUTTON,
  READY_DONE_TITLE,
  READY_LEAD,
  READY_TITLE,
  readyComplete,
  readyDevusdAmount,
  readySteps,
  readyToPay,
  type ReadyStep,
  type ReadyStepId,
} from "../../../../lib/ready.ts";
import type { FaucetView } from "../../../../lib/server/faucet.ts";
import type { SolFaucetView } from "../../../../lib/server/sol-faucet.ts";
import { WALKTHROUGH_LINK, WALKTHROUGH_PATH } from "../../../../lib/walkthrough.ts";
import { useKeySession } from "../key-session.tsx";
import { useAccountSetup, type RecordedAccount } from "./account-cards.tsx";
import cards from "./cards.module.css";
import notices from "./confidential.module.css";
import { useConfidential } from "./context.tsx";
import { DevnetSteps, Guidance } from "./guidance.tsx";
import { ConnectWallets, Explainer, useRegisterViewingKey } from "./keys.tsx";
import styles from "./ready.module.css";
import { useFunding } from "./use-funding.ts";

const TONE = {
  waiting: "neutral",
  active: "blue",
  running: "amber",
  done: "green",
  stuck: "red",
} as const;
const WORD = {
  waiting: "Waiting",
  active: "Next",
  running: "Running",
  done: "Done",
  stuck: "Not now",
} as const;

async function read<T>(path: string): Promise<T | string> {
  try {
    return await callApi<T>(path);
  } catch (error) {
    return error instanceof ApiCallError ? error.message : "Sotto could not be reached.";
  }
}

/** Whether the checklist belongs to this company: devnet, in the devnet test dollar. */
export function useReadyApplies(): boolean {
  const { network } = useConfidential();
  return network.cluster === "devnet" && Boolean(network.asset.devnetTestAsset);
}

/**
 * Whether this wallet is ready to pay, from the account's public state and the registration alone:
 * true off devnet (the checklist is devnet's), null while the account is being read.
 */
export function useReadyToPay(publicViewingKey: string | null): boolean | null {
  const { data } = useConfidential();
  const applies = useReadyApplies();
  if (!applies) return true;
  const confidential = data.wusdc?.status === "present" ? data.wusdc.confidential : null;
  return readyToPay({
    accountRead: data.wusdc !== null && !data.loading,
    accountConfigured: confidential !== null,
    viewingKeyRegistered: publicViewingKey !== null,
    appliedCredits: confidential?.appliedPendingBalanceCreditCounter ?? null,
  });
}

export type ReadyChecklistProps = {
  recorded: RecordedAccount | null;
  /** The registered public viewing key of the signed in wallet, or null. */
  publicViewingKey: string | null;
  /** The dashboard also shows the finished list's way to the first payment. */
  variant: "dashboard" | "pinned";
  /** The company has made a payment already: the dashboard's "Ready" card is no longer shown. */
  hasPayments?: boolean;
};

/** Nothing of the checklist runs off devnet: its faucets answer only there. */
export function ReadyChecklist(props: ReadyChecklistProps) {
  return useReadyApplies() ? <Checklist {...props} /> : null;
}

function Checklist({ recorded, publicViewingKey, variant, hasPayments }: ReadyChecklistProps) {
  const { wallet, orgId, network, vault, connected, data, refresh } = useConfidential();
  const { session, viewing } = useKeySession();
  const account = useAccountSetup(recorded);
  const registration = useRegisterViewingKey(publicViewingKey);
  const funding = useFunding();
  const [sol, setSol] = useState<SolFaucetView | null>(null);
  const [devusd, setDevusd] = useState<FaucetView | null>(null);
  const [solLimited, setSolLimited] = useState(false);
  const [unread, setUnread] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<ReadyStepId | null>(null);
  /** The wallet did not sign the key message in this visit's last try. */
  const [unlockRefused, setUnlockRefused] = useState(false);
  const [signatures, setSignatures] = useState<Partial<Record<ReadyStepId, string>>>({});
  const [moveAmount, setMoveAmount] = useState(READY_DEFAULT_MOVE);
  /**
   * How many times the owner chose the account step's button with the keys unlocked: each one sets
   * the account up once, as soon as the account's state against those keys is known.
   */
  const [setupAsks, setSetupAsks] = useState(0);
  const answeredSetup = useRef(0);
  const decimals = network.decimals ?? 6;
  const symbol = network.asset.symbol;

  const load = useCallback(async () => {
    const [nextSol, nextDevusd] = await Promise.all([
      read<{ faucet: SolFaucetView }>("/api/faucet/sol"),
      read<{ faucet: FaucetView }>(`/api/orgs/${orgId}/faucet`),
    ]);
    if (typeof nextSol !== "string") setSol(nextSol.faucet);
    if (typeof nextDevusd !== "string") setDevusd(nextDevusd.faucet);
    const failed = [nextSol, nextDevusd].find((answer) => typeof answer === "string");
    setUnread(typeof failed === "string" ? failed : null);
  }, [orgId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const confidential = data.wusdc?.status === "present" ? data.wusdc.confidential : null;
  const accountBusy = account.checking || account.sending.busy !== null;
  const steps = readySteps({
    sol,
    solLimited,
    devusd,
    accountConfigured: confidential !== null,
    viewingKeyRegistered: publicViewingKey !== null,
    publicBase: data.usdc?.status === "present" ? data.usdc.amount : null,
    publicWrapped: data.wusdc?.status === "present" ? data.wusdc.amount : null,
    pendingCredits: confidential?.pendingBalanceCreditCounter ?? null,
    appliedCredits: confidential?.appliedPendingBalanceCreditCounter ?? null,
    keysUnlocked: vault.unlocked !== null,
    viewingUnlocked: viewing?.wallet === wallet,
    busy: busy ?? (accountBusy ? "account" : registration.busy ? "viewingKey" : null),
    signatures: {
      ...(account.sending.done ? { account: account.sending.done.signature } : {}),
      ...signatures,
    },
    moveAmount,
  });
  // A wallet that is ready by its public facts is shown no list while the faucets are still read.
  const publicReady =
    readyToPay({
      accountRead: data.wusdc !== null,
      accountConfigured: confidential !== null,
      viewingKeyRegistered: publicViewingKey !== null,
      appliedCredits: confidential?.appliedPendingBalanceCreditCounter ?? null,
    }) === true;
  const complete = readyComplete(steps) || (publicReady && sol === null);
  const turn = steps.find((step) => step.state !== "done") ?? null;

  // While a faucet is sending, follow it; when one finishes, read the balances again.
  const following =
    (turn?.id === "sol" || turn?.id === "devusd") && turn.state === "running" && sol !== null;
  useEffect(() => {
    if (!following) return;
    const timer = setInterval(() => void load(), 3000);
    return () => {
      clearInterval(timer);
      void refresh();
    };
  }, [following, load, refresh]);

  // The account, once its button was chosen and the keys are unlocked.
  const needsSetup = account.status?.kind === "needs_setup";
  useEffect(() => {
    if (turn?.id !== "account" || !needsSetup || answeredSetup.current === setupAsks) return;
    answeredSetup.current = setupAsks;
    void account.setUp();
    // setUp reads the context's current values; this runs once per click, a second click after a
    // refused request included.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupAsks, turn?.id, needsSetup]);

  /** Unlocks the keys with the wallet when they are locked; false when the wallet did not sign. */
  async function unlocked(): Promise<boolean> {
    if (vault.unlocked) return true;
    if (!connected) return false;
    const outcome = await unlockKeys({ wallet, sign: connected.sign, session });
    if (outcome.keys === "unlocked") return true;
    setProblem("Your wallet did not sign the key message, so your keys are still locked.");
    setUnlockRefused(true);
    return false;
  }

  async function run(step: ReadyStep) {
    if (!connected?.signer) return;
    setProblem(null);
    setUnlockRefused(false);
    funding.clear();
    setBusy(step.id);
    try {
      if (step.id === "sol") {
        try {
          await callApi("/api/faucet/sol", { method: "POST", body: {} });
        } catch (error) {
          // A request refused for a limit is not an error of the owner's: the list says where
          // else devnet SOL comes from.
          if (error instanceof ApiCallError && error.status === 429) setSolLimited(true);
          else {
            setProblem(
              error instanceof ApiCallError ? error.message : "The faucet did not answer.",
            );
          }
        }
        await load();
      } else if (step.id === "account") {
        if (await unlocked()) setSetupAsks((asks) => asks + 1);
      } else if (step.id === "viewingKey") {
        await registration.register();
      } else if (step.id === "devusd") {
        if (!devusd) return;
        try {
          await callApi(`/api/orgs/${orgId}/faucet`, {
            method: "POST",
            body: { amount: formatTokenAmount(readyDevusdAmount(devusd), 6) },
          });
        } catch (error) {
          setProblem(error instanceof ApiCallError ? error.message : "The faucet did not answer.");
        }
        await load();
      } else if (step.id === "move") {
        const amount = parseTokenAmount(moveAmount, decimals);
        const held = data.usdc?.status === "present" ? data.usdc.amount : 0n;
        if (amount === null || amount <= 0n) {
          setProblem(`Enter an amount of ${symbol} above zero.`);
        } else if (amount > held) {
          setProblem(
            `Your wallet holds ${formatTokenAmount(held, decimals)} ${symbol} in its public balance, less than this amount.`,
          );
        } else {
          const signature = await funding.deposit(amount);
          if (signature) setSignatures((seen) => ({ ...seen, move: signature }));
        }
      } else if (await unlocked()) {
        const signature = await funding.apply();
        if (signature) setSignatures((seen) => ({ ...seen, apply: signature }));
      }
    } finally {
      setBusy(null);
    }
  }

  // Before the account answered for the first time there is nothing true to show yet. A network
  // that the server could not reach is not waited for: the list shows, with what could not be read.
  if (network.check.status === "ok" && data.wusdc === null && data.loading) return null;

  if (complete) {
    if (variant !== "dashboard" || hasPayments) return null;
    return (
      <Card className={styles.card} data-testid="ready-card">
        <div className={styles.readyRow}>
          <div>
            <h2 className={cards.cardTitle}>{READY_DONE_TITLE}</h2>
            <p>
              Your wallet has SOL for fees, a confidential account, a registered public viewing key
              and {symbol} in its confidential balance. Atlas Freight is a demo recipient that can
              receive at once.
            </p>
          </div>
          <Link className={styles.go} href={firstPaymentHref(orgId)} data-testid="ready-pay">
            {READY_DONE_BUTTON}
          </Link>
        </div>
      </Card>
    );
  }

  const accountProblem = account.problem ?? account.sending.problem;
  // A step whose wallet request did not go through. The app cannot see which network the wallet is
  // on, so it asks (D-38), and offers the step again.
  const walletTrouble =
    turn?.state === "active" &&
    (unlockRefused ||
      funding.problem !== null ||
      accountProblem !== null ||
      registration.problemNode !== null);
  const shown = problem ?? funding.problem ?? accountProblem ?? null;
  const done = steps.filter((step) => step.state === "done").length;
  return (
    <Card className={styles.card} data-testid="ready-checklist" data-variant={variant}>
      <div className={cards.head}>
        <h2 className={cards.cardTitle}>{READY_TITLE}</h2>
        <Chip tone="blue" data-testid="ready-status">
          {done} of {steps.length} done
        </Chip>
      </div>
      <p className={cards.lead}>
        {READY_LEAD} Each step is pictured in the{" "}
        <Link className={cards.link} href={WALKTHROUGH_PATH} data-testid="ready-walkthrough">
          {WALKTHROUGH_LINK.toLowerCase()}
        </Link>
        .
      </p>
      <ol className={styles.steps}>
        {steps.map((step, index) => {
          // A done step's proof onchain: its transaction when this visit or the faucet knows it,
          // else the token account the step changed. Registering the viewing key is no transaction.
          const onAccount =
            step.state === "done" &&
            data.wusdcAccount !== null &&
            (step.id === "account" || step.id === "move" || step.id === "apply");
          const link = step.signature
            ? explorerUrl("tx", step.signature, network.cluster)
            : onAccount && data.wusdcAccount
              ? explorerUrl("address", data.wusdcAccount, network.cluster)
              : null;
          const inTurn = turn?.id === step.id;
          return (
            <li
              key={step.id}
              className={styles.step}
              data-testid={`ready-${step.id}`}
              data-state={step.state}
            >
              <span className={styles.no} aria-hidden="true">
                {step.state === "done" ? "✓" : String(index + 1).padStart(2, "0")}
              </span>
              <div className={styles.words}>
                <b>{step.title}</b>
                <small className={styles.why}>{step.why}</small>
                <small>{step.detail}</small>
                {link ? (
                  <a className={cards.link} href={link} target="_blank" rel="noreferrer">
                    Verify on Solana
                  </a>
                ) : null}
                {inTurn && step.state === "active" ? (
                  <div className={styles.turn} data-testid="ready-turn">
                    {step.id === "account" && !vault.unlocked ? <Explainer /> : null}
                    {step.id === "move" ? (
                      <label className={styles.amount}>
                        Amount of {symbol}
                        <input
                          inputMode="decimal"
                          data-amount=""
                          value={moveAmount}
                          onChange={(event) => setMoveAmount(event.target.value)}
                        />
                      </label>
                    ) : null}
                    {step.approvals ? (
                      <p className={styles.approvals} data-testid="ready-approvals">
                        {step.approvals}
                      </p>
                    ) : null}
                    <div className={cards.actions}>
                      <Button
                        variant="blue"
                        disabled={!connected?.signer || busy !== null}
                        onClick={() => void run(step)}
                        data-testid="ready-button"
                      >
                        {step.button}
                      </Button>
                    </div>
                  </div>
                ) : null}
                {inTurn && step.id === "sol" && step.state === "stuck" ? (
                  <p className={notices.note} role="status" data-testid="ready-sol-elsewhere">
                    {SOL_ELSEWHERE_BEFORE}{" "}
                    <a
                      className={cards.link}
                      href={SOLANA_FAUCET_URL}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {SOLANA_FAUCET_NAME}
                    </a>
                    {SOL_ELSEWHERE_AFTER}
                  </p>
                ) : null}
              </div>
              <Chip tone={TONE[step.state]}>{WORD[step.state]}</Chip>
            </li>
          );
        })}
      </ol>
      {!connected ? (
        <div className={notices.note} role="status" data-testid="ready-connect">
          Connect the wallet you signed in with ({shortWallet(wallet)}) to continue. Connecting
          sends nothing.
          <ConnectWallets />
        </div>
      ) : !connected.signer ? (
        <p className={cards.problem} role="alert">
          Your wallet does not offer {network.label} for this account, so it cannot sign Sotto
          transactions here.
        </p>
      ) : null}
      {registration.problemNode ? (
        <p className={cards.problem} role="alert" data-testid="ready-problem">
          {registration.problemNode}
        </p>
      ) : (shown ?? unread) ? (
        <p className={cards.problem} role="alert" data-testid="ready-problem">
          {shown ?? unread}
        </p>
      ) : null}
      {walletTrouble && turn ? (
        <Guidance
          id="ready-wallet"
          what="This step did not finish. Your list is as it was."
          why={
            <>
              Is your wallet on devnet? A wallet on another network warns about a devnet transaction
              or refuses it. To switch:
              <DevnetSteps />
            </>
          }
        >
          <Button
            variant="blue"
            size="sm"
            disabled={!connected?.signer || busy !== null}
            onClick={() => void run(turn)}
          >
            Try again
          </Button>
        </Guidance>
      ) : null}
    </Card>
  );
}
