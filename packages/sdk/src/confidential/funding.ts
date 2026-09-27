// Funding in two signatures (06 section 4; founder, 2026-09-27, step 1.7.1): wrap and deposit go in one
// transaction when it fits the size limit of the wallet's transaction version, otherwise in two, and
// the caller records why; the apply is always its own transaction, built from a fresh read of the
// account (account.ts). No keys here: the amounts of wrap and deposit are public (facts A2).
import type { Address, Instruction, TransactionSigner } from "@solana/kit";
import type { TransactionVersionChoice } from "../tx/budget.ts";
import { measureTransaction, type TransactionMeasure } from "../tx/size.ts";
import { wrapInstructions } from "../wrap/index.ts";
import { confidentialDepositInstruction } from "./state.ts";

export type WrapAndDeposit = {
  /** The owner's wUSDC account the wrapped tokens land in and are deposited from. */
  wusdcAccount: Address;
  /** One transaction, or two (wrap, then deposit) when they do not fit together. */
  transactions: Instruction[][];
  /** Why wrap and deposit are two transactions: the combined size over the version's limit. */
  split: { size: number; limit: number } | null;
};

/** The choice itself: one transaction if the combined message fits, else wrap and deposit apart. */
export function fundingTransactions(
  wrap: readonly Instruction[],
  deposit: Instruction,
  combined: TransactionMeasure,
): Pick<WrapAndDeposit, "transactions" | "split"> {
  return combined.fits
    ? { transactions: [[...wrap, deposit]], split: null }
    : {
        transactions: [[...wrap], [deposit]],
        split: { size: combined.size, limit: combined.limit },
      };
}

export async function wrapAndDepositTransactions(input: {
  owner: TransactionSigner;
  unwrappedMint: Address;
  /** The unwrapped mint's token program: SPL Token for USDC. */
  unwrappedTokenProgram: Address;
  programAddress: Address;
  amount: bigint;
  decimals: number;
  version: TransactionVersionChoice;
}): Promise<WrapAndDeposit> {
  const wrap = await wrapInstructions({
    owner: input.owner,
    unwrappedMint: input.unwrappedMint,
    unwrappedTokenProgram: input.unwrappedTokenProgram,
    programAddress: input.programAddress,
    amount: input.amount,
  });
  const deposit = confidentialDepositInstruction({
    token: wrap.wrappedTokenAccount,
    mint: wrap.wrappedMint,
    owner: input.owner,
    amount: input.amount,
    decimals: input.decimals,
  });
  const combined = measureTransaction({
    feePayer: input.owner.address,
    instructions: [...wrap.instructions, deposit],
    version: input.version,
  });
  return {
    wusdcAccount: wrap.wrappedTokenAccount,
    ...fundingTransactions(wrap.instructions, deposit, combined),
  };
}
