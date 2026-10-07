// Compute budget per transaction version (06 section 9, facts D3). v0 carries SetComputeUnitLimit
// and SetComputeUnitPrice instructions. v1 carries the same budget in its config: the compute unit limit,
// a total priority fee in lamports (the v0 price times the limit) and a loaded account data limit,
// which v1 budgets as zero when unset (kit 8.3 V1TransactionConfig).
import {
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageComputeUnitPrice,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  setTransactionMessagePriorityFeeLamports,
  type TransactionMessage,
} from "@solana/kit";
import { MAX_COMPUTE_UNIT_LIMIT } from "./compute-budget.ts";

/** 64 MiB, the runtime maximum (solana-program-runtime 2.3.7 MAX_LOADED_ACCOUNTS_DATA_SIZE_BYTES). */
export const MAX_LOADED_ACCOUNTS_DATA_SIZE = 64 * 1024 * 1024;

export type TransactionVersionChoice = 0 | 1;

export type ComputeBudget = {
  computeUnitLimit: number;
  /** Micro-lamports per compute unit (the 75th percentile rule). */
  computeUnitPrice: bigint;
  /** v1 only; v0 keeps the runtime default. */
  loadedAccountsDataSizeLimit?: number;
};

/** The v1 total priority fee for the v0 price: ceil(price * limit / 1,000,000) lamports. */
export function priorityFeeLamports(computeUnitPrice: bigint, computeUnitLimit: number): bigint {
  const microLamports = computeUnitPrice * BigInt(computeUnitLimit);
  return (microLamports + 999_999n) / 1_000_000n;
}

/** Loaded account data limit: the simulated size plus 20 percent, at most 64 MiB. */
export function loadedAccountsDataSizeLimitFromSimulation(loadedBytes: number | undefined): number {
  if (loadedBytes === undefined) return MAX_LOADED_ACCOUNTS_DATA_SIZE;
  if (!Number.isFinite(loadedBytes) || loadedBytes < 0) {
    throw new Error("the simulated loaded account data size must not be negative");
  }
  return Math.min(Math.ceil(loadedBytes * 1.2), MAX_LOADED_ACCOUNTS_DATA_SIZE);
}

/** The budget used while simulating: the maximum limits, so the simulation itself never runs out. */
export const SIMULATION_BUDGET: ComputeBudget = {
  computeUnitLimit: MAX_COMPUTE_UNIT_LIMIT,
  computeUnitPrice: 0n,
  loadedAccountsDataSizeLimit: MAX_LOADED_ACCOUNTS_DATA_SIZE,
};

type V0Message = Extract<TransactionMessage, { version: 0 }>;
type V1Message = Extract<TransactionMessage, { version: 1 }>;

export function applyComputeBudget<TMessage extends TransactionMessage>(
  message: TMessage,
  budget: ComputeBudget,
): TMessage {
  if (message.version === 1) {
    let v1 = message as unknown as V1Message;
    v1 = setTransactionMessageComputeUnitLimit(budget.computeUnitLimit, v1);
    v1 = setTransactionMessagePriorityFeeLamports(
      priorityFeeLamports(budget.computeUnitPrice, budget.computeUnitLimit),
      v1,
    );
    v1 = setTransactionMessageLoadedAccountsDataSizeLimit(
      budget.loadedAccountsDataSizeLimit ?? MAX_LOADED_ACCOUNTS_DATA_SIZE,
      v1,
    );
    return v1 as unknown as TMessage;
  }
  if (message.version !== 0)
    throw new Error("Sotto builds version 0 and version 1 transactions only");
  let v0 = message as unknown as V0Message;
  v0 = setTransactionMessageComputeUnitLimit(budget.computeUnitLimit, v0);
  v0 = setTransactionMessageComputeUnitPrice(budget.computeUnitPrice, v0);
  return v0 as unknown as TMessage;
}
