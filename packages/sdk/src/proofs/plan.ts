// `@sotto/sdk/proofs/plan` (step 2.7): the proofs that a confidential available balance is at least a
// threshold, from the token-2022 withdraw plan for it (facts K2, 06 section 8). It loads the
// confidential SDK and @solana/zk-sdk, so only the crypto worker and tests import it; the client and
// helpers of sotto_proofs are in `@sotto/sdk/proofs`.
import type { Token } from "@solana-program/token-2022";
import type { Address } from "@solana/kit";
import {
  confidentialWithdrawPlan,
  type ConfidentialTransferPlan,
} from "../confidential/transfer.ts";
import type { ConfidentialKeyMaterial } from "../keys/index.ts";
import type { PortableInstruction } from "../tx/portable.ts";
import { contextAccounts } from "./index.ts";

export type BalanceThresholdProofs = {
  /** The transactions that create and verify the two context accounts, in order (role "proof"). */
  transactions: ConfidentialTransferPlan["transactions"];
  equalityContext: Address;
  rangeContext: Address;
  /** Closes the context accounts (and the range proof's record account), rent to the payer. */
  cleanup: PortableInstruction[];
  signers: ConfidentialTransferPlan["signers"];
  /** The available balance the proofs were made from, decrypted with the AES key. */
  availableBefore: bigint;
};

/**
 * 06 section 8 steps 2 to 6: the proofs that the available balance is at least `threshold`, from the
 * withdraw plan for `threshold` without its withdraw (facts K2). The plan is the version 0 one, whose
 * proofs land in context accounts owned by the owner; `sotto_proofs` reads context accounts only.
 * Throws when the balance is below the threshold (not proven, D-06); nothing is sent here.
 */
export async function balanceThresholdProofs(input: {
  owner: Address;
  token: Address;
  tokenAccount: Token;
  mint: Address;
  decimals: number;
  threshold: bigint;
  keys: ConfidentialKeyMaterial;
  rent: (space: bigint) => Promise<bigint>;
}): Promise<BalanceThresholdProofs> {
  const plan = await confidentialWithdrawPlan({
    owner: input.owner,
    token: input.token,
    tokenAccount: input.tokenAccount,
    mint: input.mint,
    decimals: input.decimals,
    amount: input.threshold,
    keys: input.keys,
    version: 0,
    rent: input.rent,
  });
  const transactions = plan.transactions.filter((transaction) => transaction.role === "proof");
  const contexts = contextAccounts(transactions.flatMap((transaction) => transaction.instructions));
  return {
    transactions,
    ...contexts,
    cleanup: plan.cleanup,
    signers: plan.signers,
    availableBefore: plan.availableBefore,
  };
}
