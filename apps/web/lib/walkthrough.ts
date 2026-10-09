// The walkthrough (step 4.8, D-35): from a wallet on devnet to a first confidential payment, its
// check on the explorer and a proof of funds, in the words the live screens show. The page
// /app/walkthrough and the README's section "Walkthrough" are written from these labels, and
// apps/web/test/walkthrough.test.tsx fails when a screen stops saying one of them. No server only
// imports.
import { DEMO_RECIPIENT, ENTRY_DEMO, ENTRY_QUICK_START } from "./demo.ts";
import { FIRST_RUN_TITLE } from "./first-run.ts";

export const WALKTHROUGH_PATH = "/app/walkthrough";
export const WALKTHROUGH_LINK = "Walkthrough";
export const WALKTHROUGH_TITLE = "Walkthrough: from sign in to a first confidential payment";

/** What the walkthrough suggests typing; the run of 2026-10-09 used these. */
export const WALKTHROUGH_FUND = "100000";
export const WALKTHROUGH_PAY = "1250.50";
export const WALKTHROUGH_PROOF = "50000";

/** The wallets the steps were run with, and where each keeps its network setting. */
export const WALKTHROUGH_WALLETS = {
  phantom: {
    version: "26.31.0",
    settings: "Developer Settings",
    toggle: "Testnet Mode",
    network: "Solana Devnet",
  },
  solflare: {
    version: "2.39.1",
    section: "General",
    setting: "Network",
    network: "Devnet",
    dialog: "Switching to Devnet",
    confirm: "Continue",
  },
} as const;

/**
 * Each label of Sotto's own screens that the walkthrough names, with the source file that shows it
 * and the text to find there. A label made of a constant is found by the constant's name.
 */
export const WALKTHROUGH_LABELS = {
  demoEntry: {
    label: ENTRY_DEMO.label,
    file: "app/app/_components/sign-in-screen.tsx",
    find: "ENTRY_DEMO",
  },
  quickStart: {
    label: ENTRY_QUICK_START.label,
    file: "app/app/_components/sign-in-screen.tsx",
    find: "ENTRY_QUICK_START",
  },
  connect: {
    label: "Connect",
    file: "app/app/_components/sign-in-screen.tsx",
    find: '"Connect"',
  },
  signIn: { label: "Sign in", file: "app/app/_components/sign-in-screen.tsx", find: '"Sign in"' },
  firstRun: {
    label: FIRST_RUN_TITLE,
    file: "app/app/[org]/overview/first-run-card.tsx",
    find: "{FIRST_RUN_TITLE}",
  },
  unlockAndSetUp: {
    label: "Unlock my keys and set up the account",
    file: "app/app/[org]/overview/first-run-card.tsx",
    find: '"Unlock my keys and set up the account"',
  },
  verify: {
    label: "Verify on Solana",
    file: "app/app/[org]/overview/first-run-card.tsx",
    find: "Verify on Solana",
  },
  fundLink: {
    label: "Fund your confidential account with it",
    file: "app/app/[org]/overview/first-run-card.tsx",
    find: "Fund your confidential account with it",
  },
  accountSetup: { label: "Account setup", file: "lib/org-nav.ts", find: '"Account setup"' },
  payments: { label: "Payments", file: "lib/org-nav.ts", find: '"Payments"' },
  proofs: { label: "Proofs", file: "lib/org-nav.ts", find: '"Proofs"' },
  viewingKey: {
    label: "Viewing key",
    file: "app/app/_components/confidential/keys.tsx",
    find: ">Viewing key<",
  },
  createViewingKey: {
    label: "Create viewing key",
    file: "app/app/_components/confidential/keys.tsx",
    find: '"Create viewing key"',
  },
  fundCard: {
    label: "Fund your account",
    file: "app/app/_components/confidential/account-cards.tsx",
    find: "Fund your account",
  },
  fundAmount: {
    label: "Amount of devUSD",
    file: "app/app/_components/confidential/account-cards.tsx",
    find: "Amount of {symbol}",
  },
  fundAccount: {
    label: "Fund account",
    file: "app/app/_components/confidential/account-cards.tsx",
    find: "Fund account",
  },
  payCard: {
    label: "Pay a recipient",
    file: "app/app/[org]/payments/new/payments-panel.tsx",
    find: "Pay a recipient",
  },
  recipient: {
    label: "Recipient",
    file: "app/app/[org]/payments/new/payments-panel.tsx",
    find: 'label="Recipient"',
  },
  demoRecipient: {
    label: DEMO_RECIPIENT.displayName,
    file: "lib/server/orgs.ts",
    find: "DEMO_RECIPIENT.displayName",
  },
  payAmount: {
    label: "Amount (devUSD)",
    file: "app/app/[org]/payments/new/payments-panel.tsx",
    find: "`Amount (${asset.symbol})`",
  },
  memo: {
    label: "Memo",
    file: "app/app/[org]/payments/new/payments-panel.tsx",
    find: 'label="Memo"',
  },
  pay: {
    label: "Pay",
    file: "app/app/[org]/payments/new/payments-panel.tsx",
    find: '"Pay"',
  },
  recentPayments: {
    label: "Recent payments",
    file: "app/app/[org]/payments/new/payments-panel.tsx",
    find: "Recent payments",
  },
  transactionColumn: {
    label: "Transaction",
    file: "app/app/[org]/payments/new/payments-panel.tsx",
    find: "<Th>Transaction</Th>",
  },
  newProof: {
    label: "New proof",
    file: "app/app/[org]/proofs/proofs-panel.tsx",
    find: "New proof",
  },
  atLeast: {
    label: "Balance is at least",
    file: "app/app/[org]/proofs/proofs-panel.tsx",
    find: "Balance is at least",
  },
  custom: { label: "Custom", file: "app/app/[org]/proofs/proofs-panel.tsx", find: "Custom" },
  shareWith: {
    label: "Share the answer with",
    file: "app/app/[org]/proofs/proofs-panel.tsx",
    find: "Share the answer with",
  },
  generateProof: {
    label: "Generate proof",
    file: "app/app/[org]/proofs/proofs-panel.tsx",
    find: '"Generate proof"',
  },
  openPublicPage: {
    label: "Open the public page",
    file: "app/app/[org]/proofs/proofs-panel.tsx",
    find: "Open the public page",
  },
} as const;

export type WalkthroughLabel = keyof typeof WALKTHROUGH_LABELS;

/** The steps' titles, in order; the README's section carries the same ones. */
export const WALKTHROUGH_STEPS = [
  "Switch your wallet to devnet",
  "Quick start: sign in",
  "Set up and get test money",
  "Create your viewing key",
  "Move devUSD into your confidential balance",
  "Pay Atlas Freight",
  "Check on the explorer that the amount is hidden",
  "Prove a balance without showing it",
] as const;
