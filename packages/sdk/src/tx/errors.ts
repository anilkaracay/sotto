// Transaction errors in plain language (06 section 9, 09 section 4: "Chain errors are decoded to plain
// language"). The input is the `err` value of a simulation or a signature status. Custom errors of the
// Token-2022, associated token and System programs are named with their program clients.
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  getAssociatedTokenErrorMessage,
  getToken2022ErrorMessage,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { getSystemErrorMessage, SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import type { Address } from "@solana/kit";

export type DecodedTransactionError = {
  /** A stable code for tests and logs, for example "insufficient_funds_for_fee" or "token_2022_1". */
  code: string;
  /** Plain words for the person using the app. */
  message: string;
  instructionIndex?: number;
  programAddress?: Address;
};

const TOP_LEVEL: Record<string, [string, string]> = {
  AccountNotFound: [
    "fee_payer_not_found",
    "The wallet paying the fee has no SOL yet. Add a little SOL and try again.",
  ],
  InsufficientFundsForFee: [
    "insufficient_funds_for_fee",
    "The wallet does not have enough SOL to pay the network fee.",
  ],
  BlockhashNotFound: [
    "blockhash_expired",
    "The transaction expired before the network processed it. Try again.",
  ],
  AlreadyProcessed: ["already_processed", "This transaction was already processed."],
  AccountInUse: ["account_in_use", "An account is busy with another transaction. Try again."],
  WouldExceedMaxBlockCostLimit: ["network_busy", "The network is busy. Try again in a moment."],
  WouldExceedMaxAccountCostLimit: ["network_busy", "The network is busy. Try again in a moment."],
  WouldExceedAccountDataBlockLimit: ["network_busy", "The network is busy. Try again in a moment."],
  MaxLoadedAccountsDataSizeExceeded: [
    "loaded_data_limit",
    "The transaction loads more account data than its limit allows.",
  ],
};

const INSTRUCTION_LEVEL: Record<string, [string, string]> = {
  ComputationalBudgetExceeded: [
    "compute_budget_exceeded",
    "The transaction ran out of compute units before it finished.",
  ],
  ProgramFailedToComplete: [
    "compute_budget_exceeded",
    "The transaction ran out of compute units before it finished.",
  ],
  InsufficientFunds: ["insufficient_sol", "The account does not have enough SOL for this step."],
  MissingRequiredSignature: ["missing_signature", "A required signature is missing."],
  AccountAlreadyInitialized: ["account_exists", "The account already exists."],
  UninitializedAccount: ["account_missing", "An account this step needs does not exist yet."],
};

/**
 * Plain words for the Token-2022 errors a Sotto flow meets. Codes above 19 are the confidential
 * transfer errors of `spl-token-2022-interface` 3.1.2 `TokenError` (step 2.3), which the
 * `@solana-program/token-2022` 0.19.0 client does not name.
 */
const PLAIN_TOKEN_2022: Record<number, string> = {
  1: "The token account does not have enough tokens for this step.",
  4: "The token account belongs to another wallet.",
  17: "The token account is frozen.",
  24: "The receiving account is not approved for confidential transfers.",
  25: "The receiving account does not accept confidential transfers right now.",
  26: "An account's encryption key does not match the one the transfer was prepared for.",
  27: "The confidential balance changed after this transfer was prepared, so it no longer matches and nothing moved.",
  39: "The receiving account has too many pending payments; its owner must apply the pending balance first.",
};

function customError(programAddress: Address | undefined, code: number): [string, string] {
  if (programAddress === TOKEN_2022_PROGRAM_ADDRESS) {
    const plain = PLAIN_TOKEN_2022[code];
    const named = getToken2022ErrorMessage(code as never) as string | undefined;
    return [
      `token_2022_${code}`,
      plain ?? (named ? `Token program error: ${named}.` : `Token program error ${code}.`),
    ];
  }
  if (programAddress === ASSOCIATED_TOKEN_PROGRAM_ADDRESS) {
    return [
      `associated_token_${code}`,
      `Token account error: ${getAssociatedTokenErrorMessage(code as never)}.`,
    ];
  }
  if (programAddress === SYSTEM_PROGRAM_ADDRESS) {
    return [`system_${code}`, `The ${getSystemErrorMessage(code as never)}.`];
  }
  return [
    `custom_${code}`,
    `A program ${programAddress ? `(${programAddress}) ` : ""}refused the transaction with error ${code}.`,
  ];
}

/**
 * Decodes a transaction error. `programs` lists the program address of each instruction of the message
 * that failed, in order, so custom errors can be named.
 */
export function decodeTransactionError(
  err: unknown,
  programs: readonly Address[] = [],
): DecodedTransactionError {
  if (typeof err === "string") {
    const known = TOP_LEVEL[err];
    return known
      ? { code: known[0], message: known[1] }
      : { code: `transaction_${err}`, message: `The transaction failed (${err}).` };
  }
  if (err && typeof err === "object") {
    const record = err as Record<string, unknown>;
    if ("InsufficientFundsForRent" in record) {
      return {
        code: "insufficient_funds_for_rent",
        message: "An account would not keep enough SOL to stay open (rent). Add a little SOL.",
      };
    }
    const instructionError = record.InstructionError;
    if (Array.isArray(instructionError) && instructionError.length === 2) {
      const index = Number(instructionError[0]);
      const inner = instructionError[1] as unknown;
      const programAddress = programs[index];
      const where = {
        instructionIndex: index,
        ...(programAddress ? { programAddress } : {}),
      };
      if (inner && typeof inner === "object" && "Custom" in (inner as object)) {
        const [code, message] = customError(
          programAddress,
          Number((inner as { Custom: unknown }).Custom),
        );
        return { code, message, ...where };
      }
      if (typeof inner === "string") {
        const known = INSTRUCTION_LEVEL[inner];
        return known
          ? { code: known[0], message: known[1], ...where }
          : {
              code: `instruction_${inner}`,
              message: `Step ${index + 1} of the transaction failed (${inner}).`,
              ...where,
            };
      }
      return {
        code: "instruction_error",
        message: `Step ${index + 1} of the transaction failed.`,
        ...where,
      };
    }
  }
  return { code: "unknown", message: "The transaction failed." };
}
