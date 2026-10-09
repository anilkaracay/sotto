"use client";

// The dashboard's first-run card (step 4.6, D-33): "Set up and get test money". On devnet, for a
// company in the devnet test dollar, it runs three steps in order and shows each one's progress and
// its transaction: test SOL from the faucet when the wallet has too little, the confidential account,
// and 1,000,000 devUSD from the faucet. The faucets are asked without a wallet prompt. The account's
// setup asks the wallet for the key signatures, so it waits for a click of its own, with the words
// that say what the signature does (10 section 2: never asked for automatically). The card links to
// the walkthrough, which pictures each step (step 4.8, D-35). The card is gone
// once all three are done.
import { formatTokenAmount } from "@sotto/sdk/confidential/public";
import { Button, Card, Chip } from "@sotto/ui";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiCallError, callApi } from "../../../../lib/client/api.ts";
import { unlockKeys } from "../../../../lib/crypto-worker/unlock.ts";
import { explorerUrl } from "../../../../lib/explorer.ts";
import {
  FIRST_RUN_TITLE,
  firstRunDevusdAmount,
  firstRunDone,
  firstRunSteps,
  type FirstRunStep,
} from "../../../../lib/first-run.ts";
import type { FaucetView } from "../../../../lib/server/faucet.ts";
import { WALKTHROUGH_LINK, WALKTHROUGH_PATH } from "../../../../lib/walkthrough.ts";
import type { SolFaucetView } from "../../../../lib/server/sol-faucet.ts";
import {
  useAccountSetup,
  type RecordedAccount,
} from "../../_components/confidential/account-cards.tsx";
import cards from "../../_components/confidential/cards.module.css";
import notices from "../../_components/confidential/confidential.module.css";
import { useConfidential } from "../../_components/confidential/context.tsx";
import { Explainer } from "../../_components/confidential/keys.tsx";
import { useKeySession } from "../../_components/key-session.tsx";
import styles from "./first-run.module.css";

const TONE = {
  waiting: "neutral",
  ready: "blue",
  running: "amber",
  done: "green",
  stuck: "red",
} as const;
const WORD = {
  waiting: "Waiting",
  ready: "Next",
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

/**
 * The card belongs to devnet and its test dollar. Anywhere else nothing of it runs: the faucets
 * answer only on devnet, and a question they refuse would be an error in the page for nothing.
 */
export function FirstRunCard({ recorded }: { recorded: RecordedAccount | null }) {
  const { network } = useConfidential();
  if (network.cluster !== "devnet" || !network.asset.devnetTestAsset) return null;
  return <FirstRun recorded={recorded} />;
}

function FirstRun({ recorded }: { recorded: RecordedAccount | null }) {
  const { wallet, orgId, network, vault, connected, data, refresh } = useConfidential();
  const { session } = useKeySession();
  const account = useAccountSetup(recorded);
  const [sol, setSol] = useState<SolFaucetView | null>(null);
  const [devusd, setDevusd] = useState<FaucetView | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  /** The owner clicked to set the account up: the key signatures may be asked for. */
  const [setup, setSetup] = useState(false);
  const asked = useRef({ sol: false, devusd: false, setup: false });
  /** The card ran in this visit: it stays to say that it is done. */
  const [started, setStarted] = useState(false);
  /** Why a faucet could not be read, apart from why a step failed. */
  const [unread, setUnread] = useState<string | null>(null);

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

  const accountConfigured = data.wusdc?.status === "present" && data.wusdc.confidential !== null;
  const steps = firstRunSteps({
    sol,
    devusd,
    accountConfigured,
    accountBusy: unlocking || account.checking || account.sending.busy !== null,
    accountSignature: account.sending.done?.signature ?? null,
  });
  const [solStep, accountStep, devusdStep] = steps as [FirstRunStep, FirstRunStep, FirstRunStep];
  const done = firstRunDone(steps);

  // While a faucet is sending, follow it; when one finishes, read the balances again.
  const following = solStep.state === "running" || devusdStep.state === "running";
  useEffect(() => {
    if (!following) return;
    const timer = setInterval(() => void load(), 3000);
    return () => {
      clearInterval(timer);
      void refresh();
    };
  }, [following, load, refresh]);

  // Test SOL, when the wallet has too little: asked once, without a wallet prompt.
  useEffect(() => {
    if (!running || solStep.state !== "ready" || asked.current.sol) return;
    asked.current.sol = true;
    void (async () => {
      try {
        await callApi("/api/faucet/sol", { method: "POST", body: {} });
      } catch (error) {
        setProblem(error instanceof ApiCallError ? error.message : "The faucet did not answer.");
      }
      await load();
    })();
  }, [running, solStep.state, load]);

  // The account, once the owner clicked for it and the keys are unlocked.
  const needsSetup = account.status?.kind === "needs_setup";
  useEffect(() => {
    if (!running || !setup || accountStep.state !== "ready" || !needsSetup || asked.current.setup) {
      return;
    }
    asked.current.setup = true;
    void account.setUp();
    // setUp reads the context's current values; this runs once per click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, setup, accountStep.state, needsSetup]);

  // The test dollars, once the account is set up: asked once, without a wallet prompt.
  useEffect(() => {
    if (!running || devusdStep.state !== "ready" || !devusd || asked.current.devusd) return;
    asked.current.devusd = true;
    void (async () => {
      try {
        await callApi(`/api/orgs/${orgId}/faucet`, {
          method: "POST",
          body: { amount: formatTokenAmount(firstRunDevusdAmount(devusd), 6) },
        });
      } catch (error) {
        setProblem(error instanceof ApiCallError ? error.message : "The faucet did not answer.");
      }
      await load();
    })();
  }, [running, devusdStep.state, devusd, orgId, load]);

  async function setUpAccount() {
    if (!connected) return;
    setProblem(null);
    asked.current.setup = false;
    setSetup(true);
    if (vault.unlocked) return;
    setUnlocking(true);
    try {
      const outcome = await unlockKeys({ wallet, sign: connected.sign, session });
      if (outcome.keys !== "unlocked") {
        setSetup(false);
        setProblem("Your wallet did not sign the key message, so your keys are still locked.");
      }
    } finally {
      setUnlocking(false);
    }
  }

  // Nothing to set up: the card belongs to a first run.
  if (done && !started) return null;
  // Before the faucets answered there is nothing true to show yet.
  if (!sol && !devusd && !unread) return null;

  const accountProblem = account.problem ?? account.sending.problem;
  const symbol = network.asset.symbol;
  return (
    <Card className={styles.card} data-testid="first-run-card">
      <div className={cards.head}>
        <h2 className={cards.cardTitle}>{FIRST_RUN_TITLE}</h2>
        <Chip tone={done ? "green" : "blue"} data-testid="first-run-status">
          {done ? "Done" : `${steps.filter((step) => step.state === "done").length} of 3 done`}
        </Chip>
      </div>
      <p className={cards.lead}>
        Three steps on devnet, in order: test SOL for fees, your confidential account, and {symbol}{" "}
        to try payments with. Test money has no value. Each step is pictured in the{" "}
        <Link className={cards.link} href={WALKTHROUGH_PATH} data-testid="first-run-walkthrough">
          {WALKTHROUGH_LINK.toLowerCase()}
        </Link>
        .
      </p>
      <ol className={styles.steps}>
        {steps.map((step, index) => {
          const link = step.signature ? explorerUrl("tx", step.signature, network.cluster) : null;
          return (
            <li
              key={step.id}
              className={styles.step}
              data-testid={`first-run-${step.id}`}
              data-state={step.state}
            >
              <span className={styles.no} aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className={styles.words}>
                <b>{step.title}</b>
                <small>{step.detail}</small>
                {link ? (
                  <a className={cards.link} href={link} target="_blank" rel="noreferrer">
                    Verify on Solana
                  </a>
                ) : null}
              </div>
              <Chip tone={TONE[step.state]}>{WORD[step.state]}</Chip>
            </li>
          );
        })}
      </ol>
      {running && accountStep.state === "ready" && !setup ? (
        <div className={styles.unlock} data-testid="first-run-unlock">
          {vault.unlocked ? null : <Explainer />}
          <div className={cards.actions}>
            <Button
              variant="blue"
              disabled={!connected?.signer}
              onClick={() => void setUpAccount()}
            >
              {vault.unlocked ? "Set up the account" : "Unlock my keys and set up the account"}
            </Button>
          </div>
        </div>
      ) : null}
      {!connected?.signer ? (
        <p className={notices.note} role="status">
          Connect your wallet in the wallet card below to continue.
        </p>
      ) : null}
      {accountProblem ? (
        <>
          <p className={cards.problem} role="alert">
            {accountProblem}
          </p>
          <div className={cards.actions}>
            <Button variant="line" onClick={() => void setUpAccount()}>
              Try the account again
            </Button>
          </div>
        </>
      ) : null}
      {(problem ?? unread) ? (
        <p className={cards.problem} role="alert" data-testid="first-run-problem">
          {problem ?? unread}
        </p>
      ) : null}
      {done ? (
        <p className={notices.note} role="status" data-testid="first-run-done">
          Your account is set up and your wallet holds {symbol} in its public balance.{" "}
          <Link className={cards.link} href={`/app/${orgId}/setup`}>
            Fund your confidential account with it
          </Link>
        </p>
      ) : !running ? (
        <div className={cards.actions}>
          <Button
            variant="blue"
            disabled={!connected?.signer}
            onClick={() => {
              setStarted(true);
              setProblem(null);
              setRunning(true);
            }}
          >
            {FIRST_RUN_TITLE}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
