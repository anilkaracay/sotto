// Prepares a transaction by the 06 section 9 rules, for a keypair or a wallet to sign: a fresh
// blockhash, the 75th percentile priority fee (capped), a simulation with the maximum limits, then the
// compute unit limit at the simulated units plus 20 percent, as instructions for v0 or as the config of
// v1 (with the loaded account data limit at the simulated size plus 20 percent). A failed simulation
// throws SimulationFailedError with the decoded error; nothing is signed or sent here. Since step 2.3
// a payroll chunk (06 section 7) prepares several transactions with one blockhash, and a transaction
// that cannot be simulated before the ones ahead of it land takes the budget measured for the same
// shape of transaction earlier in the run (`measured`) instead of a simulation.
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
  type TransactionSigner,
} from "@solana/kit";
import {
  applyComputeBudget,
  loadedAccountsDataSizeLimitFromSimulation,
  priorityFeeLamports,
  SIMULATION_BUDGET,
  type ComputeBudget,
  type TransactionVersionChoice,
} from "./budget.ts";
import {
  computeUnitLimitFromSimulation,
  DEFAULT_PRIORITY_FEE_CAP_MICRO_LAMPORTS,
  priorityFeeFromRecentFees,
} from "./compute-budget.ts";
import type { SolanaRpc } from "./rpc.ts";
import { SimulationFailedError, simulateWire } from "./simulate.ts";
import { writableAccounts } from "./writable.ts";

export type PreparedTransaction = {
  version: TransactionVersionChoice;
  budget: Required<Pick<ComputeBudget, "computeUnitLimit" | "computeUnitPrice">> &
    Pick<ComputeBudget, "loadedAccountsDataSizeLimit">;
  /** The v1 config value, or for v0 the fee the price and limit imply. */
  priorityFeeLamports: bigint;
  unitsConsumed: bigint;
  loadedAccountsDataSize: number | null;
};

/** A blockhash with the block height after which transactions that use it can no longer land. */
export type BlockhashLifetime = { blockhash: Blockhash; lastValidBlockHeight: bigint };

/** The limits a simulation gave, kept to budget later transactions of the same shape. */
export type MeasuredBudget = {
  computeUnitLimit: number;
  loadedAccountsDataSizeLimit?: number;
  unitsConsumed: bigint;
  loadedAccountsDataSize: number | null;
};

/** The limits of a prepared transaction, for later transactions of the same shape. */
export function measuredBudgetOf(prepared: PreparedTransaction): MeasuredBudget {
  return {
    computeUnitLimit: prepared.budget.computeUnitLimit,
    ...(prepared.budget.loadedAccountsDataSizeLimit === undefined
      ? {}
      : { loadedAccountsDataSizeLimit: prepared.budget.loadedAccountsDataSizeLimit }),
    unitsConsumed: prepared.unitsConsumed,
    loadedAccountsDataSize: prepared.loadedAccountsDataSize,
  };
}

export async function prepareTransaction(options: {
  rpc: SolanaRpc;
  version: TransactionVersionChoice;
  feePayer: Address | TransactionSigner;
  instructions: readonly Instruction[];
  priorityFeeCapMicroLamports?: bigint;
  /** One blockhash shared by the transactions of a chunk; otherwise a fresh one is read. */
  lifetime?: BlockhashLifetime;
  /** The budget measured for this shape earlier in the run; the transaction is not simulated. */
  measured?: MeasuredBudget;
}) {
  const { rpc, instructions } = options;
  const recentFees = await rpc.getRecentPrioritizationFees(writableAccounts(instructions)).send();
  const computeUnitPrice = priorityFeeFromRecentFees(
    recentFees,
    options.priorityFeeCapMicroLamports ?? DEFAULT_PRIORITY_FEE_CAP_MICRO_LAMPORTS,
  );
  const blockhash =
    options.lifetime ?? (await rpc.getLatestBlockhash({ commitment: "confirmed" }).send()).value;
  const base = pipe(
    createTransactionMessage({ version: options.version }),
    (m) =>
      typeof options.feePayer === "string"
        ? setTransactionMessageFeePayer(options.feePayer, m)
        : setTransactionMessageFeePayerSigner(options.feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  if (options.measured) {
    const { measured } = options;
    const budget: PreparedTransaction["budget"] =
      options.version === 1
        ? {
            computeUnitLimit: measured.computeUnitLimit,
            computeUnitPrice,
            loadedAccountsDataSizeLimit:
              measured.loadedAccountsDataSizeLimit ??
              loadedAccountsDataSizeLimitFromSimulation(undefined),
          }
        : { computeUnitLimit: measured.computeUnitLimit, computeUnitPrice };
    const prepared: PreparedTransaction = {
      version: options.version,
      budget,
      priorityFeeLamports: priorityFeeLamports(computeUnitPrice, measured.computeUnitLimit),
      unitsConsumed: measured.unitsConsumed,
      loadedAccountsDataSize: measured.loadedAccountsDataSize,
    };
    return { message: applyComputeBudget(base, budget), prepared };
  }
  const simulated = applyComputeBudget(base, { ...SIMULATION_BUDGET, computeUnitPrice });
  const programs = simulated.instructions.map((instruction) => instruction.programAddress);
  const simulation = await simulateWire(
    rpc,
    getBase64EncodedWireTransaction(compileTransaction(simulated)),
  );
  if (simulation.err) throw new SimulationFailedError(simulation.err, simulation.logs, programs);
  if (simulation.unitsConsumed === 0n) {
    throw new Error("the RPC did not report compute units for the simulation");
  }
  const computeUnitLimit = computeUnitLimitFromSimulation(simulation.unitsConsumed);
  const budget: PreparedTransaction["budget"] =
    options.version === 1
      ? {
          computeUnitLimit,
          computeUnitPrice,
          loadedAccountsDataSizeLimit: loadedAccountsDataSizeLimitFromSimulation(
            simulation.loadedAccountsDataSize ?? undefined,
          ),
        }
      : { computeUnitLimit, computeUnitPrice };
  const prepared: PreparedTransaction = {
    version: options.version,
    budget,
    priorityFeeLamports: priorityFeeLamports(computeUnitPrice, computeUnitLimit),
    unitsConsumed: simulation.unitsConsumed,
    loadedAccountsDataSize: simulation.loadedAccountsDataSize,
  };
  return { message: applyComputeBudget(base, budget), prepared };
}
