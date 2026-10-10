// Step 4.11 (D-38): what the pay form shows when a payment cannot go on, one block per reason, each
// in three parts: what happened, why, and the fix in place. These are the blocks as views, with no
// state of their own, so each is tested alone (test/pay-guides.test.tsx); payments-panel.tsx gives
// them the wallet, the balances and the actions.
import { formatTokenAmount } from "@sotto/sdk/confidential/public";
import { Button } from "@sotto/ui";
import type { ReactNode } from "react";
import {
  SOL_ELSEWHERE_BEFORE,
  SOLANA_FAUCET_NAME,
  SOLANA_FAUCET_URL,
  solWords,
} from "../../../../../lib/first-run.ts";
import {
  PUBLIC_VIEWING_KEY_MISSING,
  REGISTER_PUBLIC_VIEWING_KEY,
} from "../../../../../lib/key-names.ts";
import { DevnetSteps, Guidance } from "../../../_components/confidential/guidance.tsx";
import ready from "../../../_components/confidential/ready.module.css";
import { Amount, WithAmounts } from "../../../_components/privacy.tsx";

const DECIMALS = 6;
const whole = (base: bigint) => formatTokenAmount(base, DECIMALS);

/**
 * With less SOL than this a payment cannot run: about 0.0122 SOL is held by its proof accounts
 * until they close (facts O8).
 */
export const PAY_MIN_LAMPORTS = 13_000_000n;

export type InsufficientPlan = {
  /** What the available balance lacks for the amount. */
  missing: bigint;
  /** The pending balance covers it: applying is the whole fix. */
  fromPending: boolean;
  /** What has to come from the public balance, at least. */
  shortfall: bigint;
  /** The public balance covers the shortfall. */
  coverable: boolean;
};

/** How a confidential balance below the amount is filled: from pending, from public, or not at all. */
export function insufficientPlan(balances: {
  need: bigint;
  available: bigint;
  pending: bigint;
  publicBase: bigint;
}): InsufficientPlan {
  const { need, available, pending, publicBase } = balances;
  const missing = need > available ? need - available : 0n;
  const fromPending = pending >= missing;
  const shortfall = fromPending ? 0n : missing - pending;
  return { missing, fromPending, shortfall, coverable: publicBase >= shortfall };
}

/** The public viewing key is not registered: registered in place, with one signature. */
export function ViewingKeyGuide(props: {
  busy: boolean;
  canSign: boolean;
  problem: ReactNode;
  onRegister: () => void;
}) {
  return (
    <Guidance
      id="viewing-key"
      what={PUBLIC_VIEWING_KEY_MISSING}
      why="A payment's details are sealed to it, so you can read your own record and nobody else can. Registering it asks your wallet for a signature and sends no transaction."
    >
      <Button
        variant="blue"
        size="sm"
        disabled={!props.canSign || props.busy}
        onClick={props.onRegister}
      >
        {props.busy ? "Waiting for your wallet…" : REGISTER_PUBLIC_VIEWING_KEY}
      </Button>
      {props.problem ? <span>{props.problem}</span> : null}
    </Guidance>
  );
}

/** The keys are locked in the tab: unlocked in place. */
export function LockedGuide(props: {
  busy: boolean;
  canUnlock: boolean;
  problem: string | null;
  onUnlock: () => void;
}) {
  return (
    <Guidance
      id="locked"
      what="Your keys are locked in this tab."
      why="The proofs of a confidential payment are made in this tab with them. Unlocking asks your wallet for two signatures and sends no transaction."
    >
      <Button
        variant="blue"
        size="sm"
        disabled={!props.canUnlock || props.busy}
        onClick={props.onUnlock}
      >
        {props.busy ? "Waiting for your wallet…" : "Unlock my keys"}
      </Button>
      {props.problem ? <span>{props.problem}</span> : null}
    </Guidance>
  );
}

/** The chosen recipient cannot receive yet: said plainly, with the demo recipient where there is one. */
export function RecipientGuide(props: {
  name: string;
  reason: string;
  /** The demo recipient's name when the company has it and it can receive. */
  demoName: string | null;
  onPayDemo: () => void;
}) {
  return (
    <Guidance
      id="recipient"
      what={`${props.name} cannot receive a confidential payment yet.`}
      why={props.reason}
    >
      {props.demoName ? (
        <Button variant="blue" size="sm" onClick={props.onPayDemo}>
          Pay {props.demoName} instead
        </Button>
      ) : null}
    </Guidance>
  );
}

/**
 * The available confidential balance is below the amount. The block shows the three balances and
 * fills what is missing in place: applying a pending balance that covers it, or moving from the
 * public balance, with the amount prefilled to cover the payment.
 */
export function InsufficientGuide(props: {
  need: bigint;
  available: bigint;
  pending: bigint;
  publicBase: bigint;
  symbol: string;
  wrappedSymbol: string;
  /** The amount to move as typed; empty means the prefilled shortfall. */
  text: string;
  onText: (text: string) => void;
  /** The typed amount covers the shortfall and the public balance covers it. */
  valid: boolean;
  canSend: boolean;
  busy: string | null;
  problem: string | null;
  onFix: () => void;
}) {
  const plan = insufficientPlan(props);
  const idle = props.canSend && props.busy === null;
  return (
    <Guidance
      id="insufficient"
      what={
        <WithAmounts>{`Your confidential balance does not cover ${whole(props.need)} ${props.symbol}. Nothing was sent.`}</WithAmounts>
      }
      why={
        <>
          A confidential payment is paid from the available confidential balance only.
          <ul className={ready.balances} data-testid="guidance-balances">
            <li>
              Available, confidential:{" "}
              <Amount>{`${whole(props.available)} ${props.wrappedSymbol}`}</Amount>
            </li>
            <li>
              Pending, confidential:{" "}
              <Amount>{`${whole(props.pending)} ${props.wrappedSymbol}`}</Amount>
            </li>
            <li>
              Public, in your wallet:{" "}
              <Amount>{`${whole(props.publicBase)} ${props.symbol}`}</Amount>
            </li>
          </ul>
        </>
      }
    >
      {plan.fromPending ? (
        <>
          <Button variant="blue" size="sm" disabled={!idle} onClick={props.onFix}>
            Apply pending balance
          </Button>
          <span>Your wallet will ask once: one transaction that applies it.</span>
        </>
      ) : plan.coverable ? (
        <>
          <label className={ready.amount}>
            Amount of {props.symbol}
            <input
              inputMode="decimal"
              data-amount=""
              data-testid="guidance-move-amount"
              value={props.text === "" ? whole(plan.shortfall) : props.text}
              onChange={(event) => props.onText(event.target.value)}
            />
          </label>
          <Button variant="blue" size="sm" disabled={!idle || !props.valid} onClick={props.onFix}>
            Move {props.symbol} to confidential balance
          </Button>
          <span>
            Your wallet will ask 2 times: one transaction that wraps and deposits it, one that
            applies it.
          </span>
        </>
      ) : (
        <span>
          Your wallet&apos;s public balance does not cover the rest either. Pay a smaller amount.
        </span>
      )}
      {props.busy ? <span role="status">{props.busy}</span> : null}
      {props.problem ? <span>{props.problem}</span> : null}
    </Guidance>
  );
}

/**
 * Too little SOL for the payment. On devnet Sotto's faucet is asked in place; when it cannot send,
 * the block points to Solana's own faucet, and "Try again" reads the balance again.
 */
export function NoSolGuide(props: {
  lamports: bigint;
  devnet: boolean;
  /** Sotto's faucet refused this wallet, for a limit. */
  limited: boolean;
  busy: boolean;
  note: string | null;
  onGet: () => void;
  onRetry: () => void;
}) {
  return (
    <Guidance
      id="no-sol"
      what={`Your wallet holds ${solWords(props.lamports)} SOL, too little for this payment. Nothing was sent.`}
      why="A payment pays a small network fee, and its proof accounts hold about 0.0122 SOL until they close in the same payment."
    >
      {props.devnet && !props.limited ? (
        <Button variant="blue" size="sm" disabled={props.busy} onClick={props.onGet}>
          {props.busy ? "Getting test SOL…" : "Get test SOL"}
        </Button>
      ) : (
        <>
          {props.devnet ? (
            <span data-testid="guidance-sol-elsewhere">
              {SOL_ELSEWHERE_BEFORE}{" "}
              <a href={SOLANA_FAUCET_URL} target="_blank" rel="noreferrer">
                {SOLANA_FAUCET_NAME}
              </a>
              .
            </span>
          ) : (
            <span>Send SOL to this wallet first.</span>
          )}
          <Button variant="blue" size="sm" onClick={props.onRetry}>
            Try again
          </Button>
        </>
      )}
      {props.note ? <span role="status">{props.note}</span> : null}
    </Guidance>
  );
}

/**
 * The wallet rejected a request or could not sign it. The app cannot see which network a wallet is
 * on (the wallet standard does not say), so on devnet it asks, with the way there in each wallet.
 */
export function WalletGuide(props: {
  /** What happened, with the wallet's own words: it was cancelled there, or the wallet refused. */
  message: string;
  devnet: boolean;
  canRetry: boolean;
  onRetry: () => void;
}) {
  return (
    <Guidance
      id="wallet"
      what={<WithAmounts>{`${props.message} Your form is kept.`}</WithAmounts>}
      why={
        props.devnet ? (
          <>
            Is your wallet on devnet? A wallet on another network warns about a devnet transaction
            or refuses it. To switch:
            <DevnetSteps />
          </>
        ) : (
          "A payment goes out only with your wallet's approval of each request it shows."
        )
      }
    >
      <Button variant="blue" size="sm" disabled={!props.canRetry} onClick={props.onRetry}>
        Try again
      </Button>
    </Guidance>
  );
}
