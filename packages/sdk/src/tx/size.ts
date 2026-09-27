// The size of a transaction before it is prepared (06 section 4, step 1.7.1): the message the rules
// would build (the fee payer, a blockhash, the compute budget of its version, with every budget field
// set) compiled with an empty signature per signer and measured against its version's limit, 1232
// bytes for legacy and v0 and 4096 for v1 (kit 8.3 getTransactionSizeLimit).
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getTransactionSize,
  getTransactionSizeLimit,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from "@solana/kit";
import { applyComputeBudget, SIMULATION_BUDGET, type TransactionVersionChoice } from "./budget.ts";

/** Any valid blockhash: the size does not depend on its value. */
const PLACEHOLDER_BLOCKHASH = "11111111111111111111111111111111" as Blockhash;

export type TransactionMeasure = { size: number; limit: number; fits: boolean };

export function measureTransaction(options: {
  feePayer: Address;
  instructions: readonly Instruction[];
  version: TransactionVersionChoice;
}): TransactionMeasure {
  const message = pipe(
    createTransactionMessage({ version: options.version }),
    (m) => setTransactionMessageFeePayer(options.feePayer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: PLACEHOLDER_BLOCKHASH, lastValidBlockHeight: 0n },
        m,
      ),
    (m) => appendTransactionMessageInstructions(options.instructions, m),
  );
  // A price of 1 keeps the price instruction (v0) or the fee field (v1) in the measured message.
  const compiled = compileTransaction(
    applyComputeBudget(message, { ...SIMULATION_BUDGET, computeUnitPrice: 1n }),
  );
  const size = getTransactionSize(compiled);
  const limit = getTransactionSizeLimit(compiled);
  return { size, limit, fits: size <= limit };
}
