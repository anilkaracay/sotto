// A confidential transfer to one recipient (06 section 5, F-06, AC-06.4; step 1.9). It needs the
// sender's confidential keys (the proofs and the new decryptable balance), so it runs where the keys
// live: the crypto worker, or a keypair in tests. It builds the plan of
// `@solana-program/token-2022/confidential` 0.19.0 (verified from its source, VERIFICATION-LOG step
// 1.9): three proof context accounts created and verified, the transfer instruction, then the three
// accounts closed with their rent to the fee payer (06 section 5). A version 1 transaction takes the
// range proof inline; a version 0 transaction cannot hold the inline range proof together with the
// compute budget instructions of 06 section 9, so it stages the proof in an SPL Record account first,
// whose rent also returns to the fee payer. The plan is packed into transactions here, because the
// record variant's data writes are a message packer, which cannot leave this realm. The accounts the
// plan creates sign their own creation: their signers stay with the caller, which adds their
// signatures after the wallet signed (the wallet may change the compute budget, 06 section 9).
import type { Mint, Token } from "@solana-program/token-2022";
import {
  getConfidentialTransferInstructionPlan,
  getConfidentialTransferWithRecordInstructionPlan,
} from "@solana-program/token-2022/confidential";
import {
  flattenInstructionPlan,
  isSequentialInstructionPlan,
  isTransactionSigner,
  type Address,
  type GetAccountInfoApi,
  type GetMinimumBalanceForRentExemptionApi,
  type Instruction,
  type InstructionPlan,
  type KeyPairSigner,
  type Rpc,
  type TransactionSigner,
  createNoopSigner,
} from "@solana/kit";
import { AeKey, ElGamalKeypair, ElGamalSecretKey } from "@solana/zk-sdk/bundler";
import { elgamalKeyMatches, type ConfidentialKeyMaterial } from "../keys/confidential.ts";
import type { TransactionVersionChoice } from "../tx/budget.ts";
import { planTransactions } from "../tx/plan.ts";
import { toPortableInstruction, type PortableInstruction } from "../tx/portable.ts";
import { decryptTokenAccount } from "./account.ts";
import { ConfidentialAccountError, confidentialExtension } from "./state.ts";
import type { SendableTransaction, TransferTransactionRole } from "./transfer-send.ts";

const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

export type ConfidentialTransferPlan = {
  variant: "inline" | "record";
  /** In the order they must land; each is sent after the previous one confirmed. */
  transactions: SendableTransaction[];
  /**
   * The plan's closing instructions (proof context and record accounts, rent to the fee payer). If
   * the transfer does not complete, send the ones whose account exists (06 section 5).
   */
  cleanup: PortableInstruction[];
  /** The keypairs of accounts the plan creates or authorizes: they sign alongside the wallet. */
  signers: KeyPairSigner[];
  /** The sender's available balance before, decrypted with the AES key, for the integrity check. */
  availableBefore: bigint;
};

function assertRecipientCanReceive(destination: Token): void {
  const extension = confidentialExtension(destination);
  if (
    !extension ||
    !extension.approved ||
    !extension.allowConfidentialCredits ||
    extension.pendingBalanceCreditCounter >= extension.maximumPendingBalanceCreditCounter
  ) {
    throw new ConfidentialAccountError(
      "recipient_not_ready",
      "The recipient's account cannot receive a confidential transfer now",
    );
  }
}

/** The signers the plan's instructions carry, other than the wallet (a placeholder here). */
function planSigners(instructions: readonly Instruction[], wallet: Address): KeyPairSigner[] {
  const found = new Map<Address, KeyPairSigner>();
  for (const instruction of instructions) {
    for (const account of instruction.accounts ?? []) {
      const signer = (account as { signer?: { address: Address } }).signer;
      if (
        signer &&
        isTransactionSigner(signer) &&
        signer.address !== wallet &&
        "keyPair" in signer
      ) {
        found.set(signer.address, signer as KeyPairSigner);
      }
    }
  }
  return [...found.values()];
}

/** Same program, accounts and data: how a planned instruction is matched with the plan's cleanup. */
function sameInstruction(a: Instruction, b: Instruction): boolean {
  const accountsA = a.accounts ?? [];
  const accountsB = b.accounts ?? [];
  const dataA = a.data ?? new Uint8Array();
  const dataB = b.data ?? new Uint8Array();
  return (
    a.programAddress === b.programAddress &&
    accountsA.length === accountsB.length &&
    accountsA.every((account, i) => account.address === accountsB[i]?.address) &&
    dataA.length === dataB.length &&
    dataA.every((byte, i) => byte === dataB[i])
  );
}

function instructionsOf(plan: InstructionPlan): Instruction[] {
  return flattenInstructionPlan(plan).flatMap((step) =>
    step.kind === "single" ? [step.instruction] : [],
  );
}

function roleOf(instructions: readonly Instruction[]): TransferTransactionRole {
  if (instructions.some((instruction) => instruction.programAddress === TOKEN_2022_PROGRAM)) {
    return "transfer";
  }
  return "proof";
}

export async function confidentialTransferPlan(input: {
  owner: Address;
  sourceToken: Address;
  sourceTokenAccount: Token;
  destinationToken: Address;
  destinationTokenAccount: Token;
  mint: Address;
  mintAccount: Mint;
  amount: bigint;
  keys: ConfidentialKeyMaterial;
  version: TransactionVersionChoice;
  /** The rent exempt minimum for an account size; the caller asks the chain (the worker cannot). */
  rent: (space: bigint) => Promise<bigint>;
}): Promise<ConfidentialTransferPlan> {
  if (input.amount <= 0n) throw new Error("the amount must be above zero");
  if (input.sourceTokenAccount.owner !== input.owner) {
    throw new ConfidentialAccountError(
      "wrong_owner",
      "The token account belongs to another wallet",
    );
  }
  const source = confidentialExtension(input.sourceTokenAccount);
  if (!source) {
    throw new ConfidentialAccountError(
      "not_confidential",
      "The token account has no confidential balance",
    );
  }
  // I-5: the keys must be the account's before any use.
  if (!elgamalKeyMatches(input.keys.elgamalPubkey, source.elgamalPubkey)) {
    throw new ConfidentialAccountError(
      "key_mismatch",
      "The keys this wallet derives do not match the account's ElGamal key",
    );
  }
  assertRecipientCanReceive(input.destinationTokenAccount);
  const { available } = decryptTokenAccount(input.sourceTokenAccount, input.keys);
  if (available < input.amount) {
    throw new ConfidentialAccountError(
      "insufficient_balance",
      "The available confidential balance is below the amount",
    );
  }

  const wallet: TransactionSigner = createNoopSigner(input.owner);
  // The helper reads rent for the accounts it creates, and nothing else, because the mint account is
  // given; anything else fails loudly instead of reaching the network from the worker.
  const rpc = {
    getMinimumBalanceForRentExemption: (space: bigint) => ({ send: () => input.rent(space) }),
    getAccountInfo: () => {
      throw new Error("the transfer plan reads no accounts");
    },
  } as unknown as Rpc<GetMinimumBalanceForRentExemptionApi & GetAccountInfoApi>;

  const secret = ElGamalSecretKey.fromBytes(input.keys.elgamalSecretKey);
  const elgamalKeypair = ElGamalKeypair.fromSecretKey(secret);
  const aesKey = AeKey.fromBytes(input.keys.aeKey);
  try {
    const common = {
      sourceToken: input.sourceToken,
      mint: input.mint,
      mintAccount: input.mintAccount,
      destinationToken: input.destinationToken,
      destinationTokenAccount: input.destinationTokenAccount,
      sourceTokenAccount: input.sourceTokenAccount,
      authority: wallet,
      amount: input.amount,
      sourceElgamalKeypair: elgamalKeypair,
      aesKey,
      payer: wallet,
      rpc,
    };
    const variant = input.version === 1 ? "inline" : "record";
    const plan =
      variant === "inline"
        ? await getConfidentialTransferInstructionPlan(common)
        : await getConfidentialTransferWithRecordInstructionPlan(common);
    if (!isSequentialInstructionPlan(plan) || plan.plans.length !== 3) {
      throw new Error("the transfer plan must be the setup, the transfer and the cleanup");
    }
    const cleanup = instructionsOf(plan.plans[2] as InstructionPlan);
    const planned = await planTransactions({ plan, feePayer: input.owner, version: input.version });
    const isCleanup = (instruction: Instruction) =>
      cleanup.some((closing) => sameInstruction(closing, instruction));
    const transactions = planned.map((instructions) => ({
      role: instructions.every(isCleanup) ? ("cleanup" as const) : roleOf(instructions),
      instructions: instructions.map(toPortableInstruction),
    }));
    return {
      variant,
      transactions,
      cleanup: cleanup.map(toPortableInstruction),
      signers: planSigners([...planned.flat(), ...cleanup], input.owner),
      availableBefore: available,
    };
  } finally {
    elgamalKeypair.free();
    secret.free();
    aesKey.free();
  }
}
