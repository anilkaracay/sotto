// The sign in screen's wallet list by capability (D-26; step 3.4.1): every Wallet Standard wallet the
// browser has, in three groups read from its declared features, never from its name. No server only
// imports.
import {
  canBeOffered,
  canHoldConfidentialBalances,
  signInMethod,
  type WalletCapabilities,
} from "@sotto/sdk/wallet";

export type WalletGroup = "confidential" | "sign_in_only" | "unsupported";

export const GROUP_WORDS: Record<WalletGroup, { title: string; detail: string }> = {
  confidential: {
    title: "Ready for Sotto",
    detail:
      "These wallets sign in, sign transactions and sign messages, so they can hold confidential balances.",
  },
  sign_in_only: {
    title: "Sign in only",
    detail:
      "These wallets do not sign messages, which Sotto needs to derive confidential keys. They can sign in and receive public payments, not hold confidential balances.",
  },
  unsupported: {
    title: "Not usable with Sotto",
    detail: "These wallets lack a capability every Sotto user needs, so they are not offered.",
  },
};

/** D-26: which group a wallet's declared capabilities put it in. */
export function walletGroup(capabilities: WalletCapabilities): WalletGroup {
  if (!canBeOffered(capabilities) || signInMethod(capabilities) === null) return "unsupported";
  return canHoldConfidentialBalances(capabilities) ? "confidential" : "sign_in_only";
}

/** What a wallet lacks, in words, for the unsupported group. */
export function missingWords(capabilities: WalletCapabilities): string {
  const missing: string[] = [];
  if (!capabilities.connect) missing.push("connecting");
  if (!capabilities.signTransaction) missing.push("signing transactions");
  if (capabilities.solanaChains.length === 0) missing.push("a Solana network");
  if (!capabilities.signIn && !capabilities.signMessage) missing.push("signing in");
  return missing.length === 0
    ? "Nothing is missing."
    : `It does not support ${joinWords(missing)}.`;
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;
}
