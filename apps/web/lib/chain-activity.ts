// What the chain shows, in words (AC-05.3; step 2.5), for the overview's panel and its tests. No server
// only imports. Every row is public data from chain_activity: an instruction, its accounts and time,
// and an amount only where the chain shows one; a confidential amount is always "Sealed".
import { formatTokenAmount } from "@sotto/sdk/confidential/public";
import type { ChainActivityView } from "./server/chain-activity.ts";

const DECIMALS = 6;

export const CHAIN_TYPE_WORDS: Record<ChainActivityView["type"], string> = {
  account_setup: "Account set up for confidential balances",
  deposit: "Deposit to the confidential balance",
  apply_pending: "Pending balance applied",
  transfer_out: "Confidential transfer out",
  transfer_in: "Confidential transfer in",
  withdraw: "Withdrawal to the public balance",
  wrap: "USDC wrapped to wUSDC",
  unwrap: "wUSDC unwrapped to USDC",
  public_transfer_out: "Public transfer out",
  public_transfer_in: "Public transfer in",
};

/**
 * The amount as the chain shows it: a deposit's or withdrawal's public amount, "Sealed" for a
 * confidential transfer, "Public onchain" for an amount the chain shows that Sotto does not keep (a
 * wrap, an unwrap, a public transfer; ENGINEERING-RULES.md rule 4), and "No amount" for the rest.
 */
export function chainAmountWords(row: Pick<ChainActivityView, "type" | "publicAmount">): {
  text: string;
  kind: "public" | "sealed" | "not_kept" | "none";
} {
  switch (row.type) {
    case "deposit":
    case "withdraw":
      return row.publicAmount === null
        ? { text: "No amount", kind: "none" }
        : {
            text: `${formatTokenAmount(BigInt(row.publicAmount), DECIMALS)} wUSDC`,
            kind: "public",
          };
    case "transfer_out":
    case "transfer_in":
      return { text: "Sealed", kind: "sealed" };
    case "wrap":
    case "unwrap":
    case "public_transfer_out":
    case "public_transfer_in":
      return { text: "Public onchain", kind: "not_kept" };
    case "account_setup":
    case "apply_pending":
      return { text: "No amount", kind: "none" };
  }
}
