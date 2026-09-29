// What the chain shows about a token account (08 section 4, AC-05.3; step 2.5): the top level
// instructions of one transaction that touched the account, as public data only: the instruction, the
// other account and, for a confidential deposit or withdrawal, the amount, which is public onchain.
// Nothing else is read from an instruction's data: a confidential transfer's amount is a ciphertext,
// and the amounts of wraps, unwraps and public transfers are public but Sotto does not keep them
// (ENGINEERING-RULES.md rule 4 allows only deposit and withdraw amounts). Legacy, version 0 and version 1
// transactions decode the same way (`decompileTransactionMessage`, kit 8.3); a version 0 transaction
// that loads accounts from lookup tables is reported as such and not read, because its accounts need
// the tables' contents. Instructions called by other programs (inner instructions) are not read.
import {
  getConfidentialDepositInstructionDataDecoder,
  getConfidentialWithdrawInstructionDataDecoder,
  identifyToken2022Instruction,
  Token2022Instruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import { identifyTokenWrapInstruction, TokenWrapInstruction } from "@solana-program/token-wrap";
import {
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type Address,
} from "@solana/kit";

export const CHAIN_ACTIVITY_TYPES = [
  "account_setup",
  "deposit",
  "apply_pending",
  "transfer_out",
  "transfer_in",
  "withdraw",
  "wrap",
  "unwrap",
  "public_transfer_out",
  "public_transfer_in",
] as const;

export type ChainActivityType = (typeof CHAIN_ACTIVITY_TYPES)[number];

export type ChainActivity = {
  /** The instruction's place among the transaction's top level instructions, from 0. */
  instructionIndex: number;
  type: ChainActivityType;
  /** The other token account of a transfer; null for the rest. */
  counterparty: Address | null;
  /** Base units of a confidential deposit or withdrawal, public onchain; null for every other type. */
  publicAmount: bigint | null;
};

export type ActivityResult =
  | { kind: "read"; activity: ChainActivity[] }
  /** A version 0 transaction with address lookup tables: not read (see the header). */
  | { kind: "lookup_tables" };

function token2022Type(data: Uint8Array): Token2022Instruction | null {
  try {
    return identifyToken2022Instruction(data);
  } catch {
    return null;
  }
}

function tokenWrapType(data: Uint8Array): TokenWrapInstruction | null {
  try {
    return identifyTokenWrapInstruction(data);
  } catch {
    return null;
  }
}

/** One instruction's activity for the account, or null when it does not touch it or is not read. */
function instructionActivity(
  instruction: { programAddress: Address; accounts: readonly Address[]; data: Uint8Array },
  account: Address,
  tokenWrapProgram: Address,
): Omit<ChainActivity, "instructionIndex"> | null {
  const { accounts, data } = instruction;
  const at = (index: number) => accounts[index] ?? null;
  const transfer = (source: Address | null, destination: Address | null, public_: boolean) => {
    if (source === account) {
      return {
        type: public_ ? ("public_transfer_out" as const) : ("transfer_out" as const),
        counterparty: destination,
        publicAmount: null,
      };
    }
    if (destination === account) {
      return {
        type: public_ ? ("public_transfer_in" as const) : ("transfer_in" as const),
        counterparty: source,
        publicAmount: null,
      };
    }
    return null;
  };
  if (instruction.programAddress === TOKEN_2022_PROGRAM_ADDRESS) {
    switch (token2022Type(data)) {
      case Token2022Instruction.ConfigureConfidentialTransferAccount:
      case Token2022Instruction.ConfigureConfidentialTransferAccountWithRegistry:
        return at(0) === account
          ? { type: "account_setup", counterparty: null, publicAmount: null }
          : null;
      case Token2022Instruction.ConfidentialDeposit:
        return at(0) === account
          ? {
              type: "deposit",
              counterparty: null,
              publicAmount: getConfidentialDepositInstructionDataDecoder().decode(data).amount,
            }
          : null;
      case Token2022Instruction.ConfidentialWithdraw:
        return at(0) === account
          ? {
              type: "withdraw",
              counterparty: null,
              publicAmount: getConfidentialWithdrawInstructionDataDecoder().decode(data).amount,
            }
          : null;
      case Token2022Instruction.ApplyConfidentialPendingBalance:
        return at(0) === account
          ? { type: "apply_pending", counterparty: null, publicAmount: null }
          : null;
      case Token2022Instruction.ConfidentialTransfer:
      case Token2022Instruction.ConfidentialTransferWithFee:
        return transfer(at(0), at(2), false);
      case Token2022Instruction.Transfer:
        return transfer(at(0), at(1), true);
      case Token2022Instruction.TransferChecked:
      case Token2022Instruction.TransferCheckedWithFee:
        return transfer(at(0), at(2), true);
      default:
        return null;
    }
  }
  if (instruction.programAddress === tokenWrapProgram) {
    switch (tokenWrapType(data)) {
      // Token Wrap 2.7.1: Wrap's first account is the recipient's wrapped token account, Unwrap's
      // seventh the wrapped token account it burns from.
      case TokenWrapInstruction.Wrap:
        return at(0) === account ? { type: "wrap", counterparty: null, publicAmount: null } : null;
      case TokenWrapInstruction.Unwrap:
        return at(6) === account
          ? { type: "unwrap", counterparty: null, publicAmount: null }
          : null;
      default:
        return null;
    }
  }
  return null;
}

/**
 * The account's activity in a transaction, from its wire bytes as `getTransaction` returns them with
 * `encoding: "base64"` and `maxSupportedTransactionVersion: 1` (facts D2).
 */
export function activityOf(options: {
  wire: Uint8Array;
  account: Address;
  tokenWrapProgram: Address;
}): ActivityResult {
  const transaction = getTransactionDecoder().decode(options.wire);
  const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  if (
    compiled.version === 0 &&
    "addressTableLookups" in compiled &&
    (compiled.addressTableLookups?.length ?? 0) > 0
  ) {
    return { kind: "lookup_tables" };
  }
  const message = decompileTransactionMessage(compiled);
  const activity: ChainActivity[] = [];
  message.instructions.forEach((instruction, instructionIndex) => {
    const found = instructionActivity(
      {
        programAddress: instruction.programAddress,
        accounts: (instruction.accounts ?? []).map((meta) => meta.address),
        data: new Uint8Array(instruction.data ?? []),
      },
      options.account,
      options.tokenWrapProgram,
    );
    if (found) activity.push({ instructionIndex, ...found });
  });
  return { kind: "read", activity };
}
