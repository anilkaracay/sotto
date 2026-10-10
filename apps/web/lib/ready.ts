// "Get ready to pay" (step 4.11, D-38): the checklist that takes a new company on devnet from sign in
// to a wallet that can pay, as six steps in order, each with why it is needed, one button, and what
// the wallet will ask. Exactly one step is active at a time. No server only imports: this is the
// logic, from what the faucets, the server and the chain say; the component runs the steps.
//
// The last two steps are read from two public counters of the token account (facts O7): the pending
// credit counter and the counter as it stood at the last apply. So the list stays complete after a
// reload, when no key is unlocked in the tab.
import { DEMO_RECIPIENT } from "./demo.ts";
import { FIRST_RUN_DEVUSD, FIRST_RUN_MIN_SOL, solWords } from "./first-run.ts";
import type { FaucetView } from "./server/faucet.ts";
import type { SolFaucetView } from "./server/sol-faucet.ts";

export const READY_TITLE = "Get ready to pay";
export const READY_LEAD =
  "Six steps on devnet, one at a time. Test money has no value, and nothing is signed until you choose a step's button.";
export const READY_DONE_TITLE = "Ready. Make your first confidential payment";
export const READY_DONE_BUTTON = "Pay Atlas Freight";
/** The starting amount the checklist offers to move into the confidential balance, in whole devUSD. */
export const READY_DEFAULT_MOVE = "100000";
/** What a page says of its own action while the checklist is not complete. */
export const READY_FIRST = "Finish Get ready to pay above first: it makes this wallet ready.";

export type ReadyStepId = "sol" | "account" | "viewingKey" | "devusd" | "move" | "apply";
export const READY_ORDER: readonly ReadyStepId[] = [
  "sol",
  "account",
  "viewingKey",
  "devusd",
  "move",
  "apply",
];

export type ReadyState =
  /** Not its turn yet. */
  | "waiting"
  /** Its turn: its button is the one clear thing to do. */
  | "active"
  | "running"
  | "done"
  /** Its turn, and it cannot run now; the detail says why. */
  | "stuck";

export type ReadyFacts = {
  /** The SOL faucet's view of the wallet; null until it is read. */
  sol: SolFaucetView | null;
  /** The SOL faucet refused this wallet's request for a limit. */
  solLimited: boolean;
  /** The devUSD faucet's view of the wallet; null until it is read. */
  devusd: FaucetView | null;
  /** The wallet's wrapped account exists with the confidential extension. */
  accountConfigured: boolean;
  /** The public half of the viewing key is registered with Sotto for this wallet. */
  viewingKeyRegistered: boolean;
  /** The wallet's public balances in base units; null while not read or when the account is absent. */
  publicBase: bigint | null;
  publicWrapped: bigint | null;
  /** The token account's two public counters; null while the account is not read or not set up. */
  pendingCredits: bigint | null;
  appliedCredits: bigint | null;
  /** The keys are unlocked in this tab, and the private viewing key with them. */
  keysUnlocked: boolean;
  viewingUnlocked: boolean;
  /** The step the page is running now: the wallet is signing or a transaction is on its way. */
  busy: ReadyStepId | null;
  /** The transactions that landed in this visit, for "Verify on Solana". */
  signatures: Partial<Record<ReadyStepId, string>>;
  /** The whole devUSD the move step will move, as typed. */
  moveAmount: string;
};

export type ReadyStep = {
  id: ReadyStepId;
  title: string;
  /** One plain line: why the step is needed. */
  why: string;
  state: ReadyState;
  /** What is true now, or what the step did. */
  detail: string;
  /** The step's one button, when it is active. */
  button: string | null;
  /** Before the wallet opens: how many approvals to expect and what they are for. */
  approvals: string | null;
  /** The step's transaction, for "Verify on Solana". */
  signature: string | null;
};

const TITLES: Record<ReadyStepId, string> = {
  sol: "Test SOL for fees",
  account: "Confidential account",
  viewingKey: "Public viewing key",
  devusd: "1,000,000 devUSD",
  move: "Move devUSD into the confidential balance",
  apply: "Apply the pending balance",
};

export const READY_WHY: Record<ReadyStepId, string> = {
  sol: "Every Solana transaction pays a small network fee in SOL.",
  account: "Your confidential balance lives in an account that only your keys can read.",
  viewingKey:
    "Each payment's details are sealed to this key, so you can read your own records and nobody else can.",
  devusd: "Test dollars to pay with. They have no value.",
  move: "Only money in the confidential balance can be paid with its amount hidden.",
  apply: "A deposit arrives as pending. Applying it makes it available to spend.",
};

const NO_WALLET = "No wallet approval: Sotto sends it.";

/** "100,000": whole units with thousands separators, for a button. */
export function groupedWhole(text: string): string {
  const [whole = "", fraction] = text.trim().split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

type Raw = Pick<ReadyStep, "state" | "detail"> & {
  button?: string;
  approvals?: string;
  signature?: string | null;
};

function solRaw(facts: ReadyFacts): Raw {
  const { sol } = facts;
  if (!sol) return { state: "running", detail: "Reading your wallet's SOL." };
  const holds = `Your wallet holds ${solWords(BigInt(sol.balanceLamports))} SOL`;
  const latest = sol.grants[0];
  if (latest && (latest.status === "pending" || latest.status === "sent")) {
    return {
      state: "running",
      detail: `Sotto is sending ${solWords(BigInt(latest.lamports))} SOL. This takes about half a minute.`,
      signature: latest.signature,
    };
  }
  const paid = sol.grants.find((grant) => grant.status === "paid") ?? null;
  const enough = BigInt(sol.balanceLamports) >= FIRST_RUN_MIN_SOL;
  if (sol.state === "not_needed" || enough || (sol.state === "used" && paid)) {
    return {
      state: "done",
      detail: paid
        ? `Sotto sent ${solWords(BigInt(paid.lamports))} SOL. ${holds}.`
        : `${holds}, enough for fees.`,
      signature: paid?.signature ?? null,
    };
  }
  if (sol.state === "available" && !facts.solLimited) {
    return {
      state: "active",
      detail: `${holds}. Sotto sends it ${solWords(BigInt(sol.grantLamports))} SOL.`,
      button: "Get test SOL",
      approvals: NO_WALLET,
    };
  }
  return {
    state: "stuck",
    detail:
      sol.state === "refilling"
        ? "Test SOL is being refilled, try again later."
        : sol.state === "daily_total"
          ? "The faucet has given out its SOL for today."
          : `${holds}.`,
  };
}

function accountRaw(facts: ReadyFacts): Raw {
  if (facts.accountConfigured) {
    return { state: "done", detail: "Your account is set up with your encryption key." };
  }
  return {
    state: "active",
    detail: "Your wallet signs the key messages, then one transaction sets the account up.",
    button: facts.keysUnlocked ? "Set up the account" : "Unlock my keys and set up the account",
    approvals: facts.keysUnlocked
      ? "Your wallet will ask 2 times: one message that checks your key signature stays the same, then one transaction that sets the account up."
      : "Your wallet will ask 4 times: three messages that make and check your keys in this tab, then one transaction that sets the account up. Signing a message sends nothing and costs nothing.",
  };
}

function viewingKeyRaw(facts: ReadyFacts): Raw {
  if (facts.viewingKeyRegistered) {
    return { state: "done", detail: "Registered. Payment records can be sealed to you." };
  }
  return {
    state: "active",
    detail: "Sotto stores the public half only. The private half stays in this tab.",
    button: "Register public viewing key",
    approvals: facts.viewingUnlocked
      ? "Your wallet will ask once: one message that publishes the public half of your viewing key. No transaction."
      : "Your wallet will ask 2 times: one message that makes your viewing key in this tab, one that publishes its public half. No transaction.",
  };
}

/** The wallet holds test dollars somewhere: public, wrapped, pending or applied. */
function hasDevusd(facts: ReadyFacts): boolean {
  return (
    (facts.publicBase ?? 0n) > 0n ||
    (facts.publicWrapped ?? 0n) > 0n ||
    (facts.pendingCredits ?? 0n) > 0n ||
    (facts.appliedCredits ?? 0n) > 0n
  );
}

function devusdRaw(facts: ReadyFacts): Raw {
  const mints = facts.devusd?.mints ?? [];
  const minted = mints.find((mint) => mint.status === "minted") ?? null;
  const open = mints.find((mint) => mint.status === "pending" || mint.status === "sent") ?? null;
  if (minted || hasDevusd(facts)) {
    return {
      state: "done",
      detail: minted
        ? "Minted to your wallet's public balance."
        : "Your wallet holds devUSD already.",
      signature: minted?.signature ?? null,
    };
  }
  if (open) {
    return {
      state: "running",
      detail: "Sotto is minting it. This takes about half a minute.",
      signature: open.signature,
    };
  }
  if (!facts.devusd) return { state: "running", detail: "Reading the faucet." };
  if (BigInt(facts.devusd.remaining) > 0n) {
    return {
      state: "active",
      detail: "A test token, minted to your wallet's public balance.",
      button: "Get 1,000,000 devUSD",
      approvals: NO_WALLET,
    };
  }
  return {
    state: "stuck",
    detail: "Your wallet got its devUSD for these 24 hours. Try again tomorrow.",
  };
}

function moveRaw(facts: ReadyFacts): Raw {
  if ((facts.pendingCredits ?? 0n) > 0n || (facts.appliedCredits ?? 0n) > 0n) {
    return { state: "done", detail: "Deposited into your confidential balance." };
  }
  const amount = groupedWhole(facts.moveAmount || READY_DEFAULT_MOVE);
  return {
    state: "active",
    detail:
      "The amount you move is public onchain; the balance it joins and what you pay from it are not.",
    button: `Move ${amount} devUSD`,
    approvals:
      "Your wallet will ask once: one transaction that wraps the devUSD and deposits it into your confidential balance.",
  };
}

function applyRaw(facts: ReadyFacts): Raw {
  // Applied once is enough: what arrives later is applied by the payment that needs it.
  if ((facts.appliedCredits ?? 0n) > 0n) {
    return { state: "done", detail: "Applied. Your confidential balance can be spent." };
  }
  return {
    state: "active",
    detail: "Your deposit waits as pending.",
    button: facts.keysUnlocked ? "Apply pending balance" : "Unlock my keys and apply",
    approvals: facts.keysUnlocked
      ? "Your wallet will ask once: one transaction that applies the pending balance."
      : "Your wallet will ask 3 times: two messages that unlock your keys in this tab, then one transaction that applies the pending balance.",
  };
}

const RAW: Record<ReadyStepId, (facts: ReadyFacts) => Raw> = {
  sol: solRaw,
  account: accountRaw,
  viewingKey: viewingKeyRaw,
  devusd: devusdRaw,
  move: moveRaw,
  apply: applyRaw,
};

/**
 * The six steps. The first one that is not done is the one in turn: active with its button,
 * running, or stuck. Every step after it waits, whatever its own facts say.
 */
export function readySteps(facts: ReadyFacts): ReadyStep[] {
  let turnTaken = false;
  return READY_ORDER.map((id) => {
    const raw = RAW[id](facts);
    const base = {
      id,
      title: TITLES[id],
      why: READY_WHY[id],
      signature: facts.signatures[id] ?? raw.signature ?? null,
    };
    if (raw.state === "done") {
      return { ...base, state: "done" as const, detail: raw.detail, button: null, approvals: null };
    }
    if (turnTaken) {
      return {
        ...base,
        state: "waiting" as const,
        detail: "After the step above.",
        button: null,
        approvals: null,
        signature: null,
      };
    }
    turnTaken = true;
    if (facts.busy === id) {
      return {
        ...base,
        state: "running" as const,
        detail: "Waiting for your wallet, then for the network.",
        button: null,
        approvals: raw.approvals ?? null,
      };
    }
    return {
      ...base,
      state: raw.state,
      detail: raw.detail,
      button: raw.state === "active" ? (raw.button ?? null) : null,
      approvals: raw.state === "active" ? (raw.approvals ?? null) : null,
    };
  });
}

export const readyComplete = (steps: readonly ReadyStep[]): boolean =>
  steps.every((step) => step.state === "done");

/** The step in turn, or null when the list is complete. */
export const readyTurn = (steps: readonly ReadyStep[]): ReadyStep | null =>
  steps.find((step) => step.state !== "done") ?? null;

/** What the devUSD step asks the faucet for: 1,000,000 devUSD, or what the wallet's day has left. */
export function readyDevusdAmount(devusd: FaucetView): bigint {
  const remaining = BigInt(devusd.remaining);
  return remaining < FIRST_RUN_DEVUSD ? remaining : FIRST_RUN_DEVUSD;
}

/** Where the finished checklist sends the owner: the pay form with the demo recipient chosen. */
export function firstPaymentHref(orgId: string): string {
  return `/app/${orgId}/payments/new?to=${DEMO_RECIPIENT.wallet}`;
}

/**
 * Whether the wallet is ready to pay, from public facts alone, so a page can say so before any
 * faucet is read and after a reload: the account is set up, the public viewing key is registered and
 * a balance was applied at least once. Null while the account has not been read.
 */
export function readyToPay(facts: {
  accountRead: boolean;
  accountConfigured: boolean;
  viewingKeyRegistered: boolean;
  appliedCredits: bigint | null;
}): boolean | null {
  if (!facts.accountRead) return null;
  return facts.accountConfigured && facts.viewingKeyRegistered && (facts.appliedCredits ?? 0n) > 0n;
}
