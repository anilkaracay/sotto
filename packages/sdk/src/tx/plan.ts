// Instruction plans in transactions (06 sections 5 and 9, step 1.9). A plan helper, such as the
// confidential transfer's, returns an instruction plan; kit's transaction planner packs it into
// transaction messages that fit their version's size limit. The planner here measures each message
// with the compute budget the rules add later (every field set, as size.ts does), so a planned
// transaction still fits once prepared. The result is the plan instructions per transaction, in the
// order they must land, without the budget: prepareTransaction adds the real one.
import {
  createTransactionMessage,
  createTransactionPlanner,
  flattenTransactionPlan,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
  type InstructionPlan,
} from "@solana/kit";
import { applyComputeBudget, SIMULATION_BUDGET, type TransactionVersionChoice } from "./budget.ts";
import type { PortableInstruction } from "./portable.ts";
import { COMPUTE_BUDGET_PROGRAM } from "./signed-message.ts";

/** Any valid blockhash: the size does not depend on its value. */
const PLACEHOLDER_BLOCKHASH = "11111111111111111111111111111111" as Blockhash;

/** A portable instruction back as a kit instruction; signer accounts stay signers without signer objects. */
export function fromPortableInstruction(portable: PortableInstruction): Instruction {
  return {
    programAddress: portable.programAddress,
    accounts: portable.accounts.map(({ address, role }) => ({ address, role })),
    data: new Uint8Array(portable.data),
  };
}

/** Packs a plan into transactions for this fee payer and version; throws if a part cannot fit. */
export async function planTransactions(options: {
  plan: InstructionPlan;
  feePayer: Address;
  version: TransactionVersionChoice;
}): Promise<Instruction[][]> {
  const planner = createTransactionPlanner({
    createTransactionMessage: () =>
      applyComputeBudget(
        pipe(
          createTransactionMessage({ version: options.version }),
          (m) => setTransactionMessageFeePayer(options.feePayer, m),
          (m) =>
            setTransactionMessageLifetimeUsingBlockhash(
              { blockhash: PLACEHOLDER_BLOCKHASH, lastValidBlockHeight: 0n },
              m,
            ),
        ),
        // A price of 1 keeps the price instruction (v0) or the fee field (v1) in the measure.
        { ...SIMULATION_BUDGET, computeUnitPrice: 1n },
      ),
  });
  const planned = await planner(options.plan);
  return flattenTransactionPlan(planned).map((transaction) =>
    transaction.message.instructions.filter(
      (instruction) => instruction.programAddress !== COMPUTE_BUDGET_PROGRAM,
    ),
  );
}
