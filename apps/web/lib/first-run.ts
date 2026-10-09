// The dashboard's first-run card, "Set up and get test money" (step 4.6, D-33), as steps: what each
// of the three is doing, from what the faucets and the chain say. No server only imports. The order
// is the one a new wallet needs: test SOL first, as the account's setup pays a fee and rent; then the
// confidential account; then the test dollars.
import type { FaucetView } from "./server/faucet.ts";
import type { SolFaucetView } from "./server/sol-faucet.ts";

export const FIRST_RUN_TITLE = "Set up and get test money";
/** What the card asks the devUSD faucet for: 1,000,000 devUSD, the wallet's whole day. */
export const FIRST_RUN_DEVUSD = 1_000_000_000_000n;
/** With less SOL than this the account's setup cannot pay its fee and rent (0.005 SOL). */
export const FIRST_RUN_MIN_SOL = 5_000_000n;

export type FirstRunFacts = {
  /** The SOL faucet's view of the wallet; null until it is read. */
  sol: SolFaucetView | null;
  /** The devUSD faucet's view of the wallet; null until it is read. */
  devusd: FaucetView | null;
  /** The wallet's wrapped account exists with the confidential extension. */
  accountConfigured: boolean;
  /** The account's setup is running: the wallet is signing or the transaction is on its way. */
  accountBusy: boolean;
  /** The setup transaction that landed in this visit, if one did. */
  accountSignature: string | null;
};

export type FirstRunStepId = "sol" | "account" | "devusd";
export type FirstRunState =
  /** Not its turn yet, or its facts are not read yet. */
  | "waiting"
  /** Its turn: the card can run it. */
  | "ready"
  | "running"
  | "done"
  /** It cannot run now; the detail says why. */
  | "stuck";

export type FirstRunStep = {
  id: FirstRunStepId;
  title: string;
  state: FirstRunState;
  detail: string;
  /** The step's transaction, for "Verify on Solana". */
  signature: string | null;
};

const SOL = 1_000_000_000n;
/** "0.05": lamports as SOL, without trailing zeros. */
export function solWords(lamports: bigint): string {
  const whole = lamports / SOL;
  const fraction = (lamports % SOL).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function solStep(sol: SolFaucetView | null): FirstRunStep {
  const base = { id: "sol" as const, title: "Test SOL for fees", signature: null };
  if (!sol) return { ...base, state: "waiting", detail: "Reading your wallet's SOL." };
  const holds = `Your wallet holds ${solWords(BigInt(sol.balanceLamports))} SOL`;
  const latest = sol.grants[0];
  if (latest && (latest.status === "pending" || latest.status === "sent")) {
    return {
      ...base,
      state: "running",
      detail: `Sotto is sending ${solWords(BigInt(latest.lamports))} SOL. This takes about half a minute.`,
      signature: latest.signature,
    };
  }
  const paid = sol.grants.find((grant) => grant.status === "paid") ?? null;
  if (sol.state === "not_needed" || (sol.state === "used" && paid)) {
    return {
      ...base,
      state: "done",
      detail: paid
        ? `Sotto sent ${solWords(BigInt(paid.lamports))} SOL. ${holds}.`
        : `${holds}, enough for fees.`,
      signature: paid?.signature ?? null,
    };
  }
  if (sol.state === "available") {
    return {
      ...base,
      state: "ready",
      detail: `${holds}. Sotto sends it ${solWords(BigInt(sol.grantLamports))} SOL for network fees and account rent.`,
    };
  }
  return {
    ...base,
    state: "stuck",
    detail:
      sol.state === "refilling"
        ? "Test SOL is being refilled, try again later."
        : sol.state === "daily_total"
          ? "The faucet has given out its SOL for today. Get devnet SOL at faucet.solana.com, or try again tomorrow."
          : `${holds}. It can ask the faucet again later.`,
  };
}

/** Whether the wallet can pay for the account's setup: the SOL step is done, or it holds enough anyway. */
function hasSol(sol: SolFaucetView | null, step: FirstRunStep): boolean {
  return (
    step.state === "done" || (sol !== null && BigInt(sol.balanceLamports) >= FIRST_RUN_MIN_SOL)
  );
}

export function firstRunSteps(facts: FirstRunFacts): FirstRunStep[] {
  const sol = solStep(facts.sol);
  const funded = hasSol(facts.sol, sol);

  const account: FirstRunStep = {
    id: "account",
    title: "Confidential account",
    signature: facts.accountSignature,
    ...(facts.accountConfigured
      ? { state: "done", detail: "Your account is set up with your encryption key." }
      : facts.accountBusy
        ? { state: "running", detail: "Waiting for your wallet, then for the network." }
        : funded
          ? {
              state: "ready",
              detail:
                "Your wallet signs the key message, then one transaction that sets the account up.",
            }
          : { state: "waiting", detail: "Once your wallet has SOL for the fee and the rent." }),
  };

  const minted = facts.devusd?.mints.find((mint) => mint.status === "minted") ?? null;
  const open =
    facts.devusd?.mints.find((mint) => mint.status === "pending" || mint.status === "sent") ?? null;
  const remaining = facts.devusd ? BigInt(facts.devusd.remaining) : 0n;
  const devusd: FirstRunStep = {
    id: "devusd",
    title: "1,000,000 devUSD",
    signature: minted?.signature ?? open?.signature ?? null,
    ...(!facts.devusd
      ? { state: "waiting", detail: "Reading the faucet." }
      : minted
        ? { state: "done", detail: "Minted to your wallet's public balance. It has no value." }
        : open
          ? {
              state: "running",
              detail: "Sotto is minting it. This takes about half a minute.",
            }
          : account.state !== "done"
            ? { state: "waiting", detail: "Once your account is set up." }
            : remaining > 0n
              ? {
                  state: "ready",
                  detail: "A test token with no value, minted to your wallet's public balance.",
                }
              : {
                  state: "stuck",
                  detail: "Your wallet got its devUSD for these 24 hours. Try again tomorrow.",
                }),
  };
  return [sol, account, devusd];
}

export const firstRunDone = (steps: readonly FirstRunStep[]): boolean =>
  steps.every((step) => step.state === "done");

/** What the devUSD step asks for: 1,000,000 devUSD, or what the wallet's day has left. */
export function firstRunDevusdAmount(devusd: FaucetView): bigint {
  const remaining = BigInt(devusd.remaining);
  return remaining < FIRST_RUN_DEVUSD ? remaining : FIRST_RUN_DEVUSD;
}
