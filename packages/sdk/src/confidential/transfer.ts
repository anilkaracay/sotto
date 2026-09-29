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
// Since step 1.10 a withdraw from the available balance to the public balance (06 section 6, AC-09.1)
// uses the same machinery: its plan has two proofs (equality and a 64 bit range proof), the withdraw
// instruction and the closes, and its main transaction carries the role "transfer" like a transfer's.
// Since step 2.3 a payroll chunk (06 section 7, facts K6) builds the plans of several lines before any
// is sent: each line's plan is built against the source state the previous line leaves, whose
// available balance ciphertext is the one in the previous plan's equality proof and whose decryptable
// balance is the previous plaintext minus its amount, encrypted with the AES key.
import type { Mint, Token } from "@solana-program/token-2022";
import {
  ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
  ZkElGamalProofInstruction,
} from "@solana-program/zk-elgamal-proof";
import {
  getConfidentialTransferInstructionPlan,
  getConfidentialTransferWithRecordInstructionPlan,
  getConfidentialWithdrawInstructionPlan,
  getConfidentialWithdrawWithRecordInstructionPlan,
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

/** Packs a plan of setup, main instruction and cleanup into labeled transactions and its signers. */
async function packPlan(
  plan: InstructionPlan,
  owner: Address,
  version: TransactionVersionChoice,
): Promise<Pick<ConfidentialTransferPlan, "transactions" | "cleanup" | "signers">> {
  if (!isSequentialInstructionPlan(plan) || plan.plans.length !== 3) {
    throw new Error("the plan must be the setup, the main instruction and the cleanup");
  }
  const cleanup = instructionsOf(plan.plans[2] as InstructionPlan);
  const planned = await planTransactions({ plan, feePayer: owner, version });
  const isCleanup = (instruction: Instruction) =>
    cleanup.some((closing) => sameInstruction(closing, instruction));
  return {
    transactions: planned.map((instructions) => ({
      role: instructions.every(isCleanup) ? ("cleanup" as const) : roleOf(instructions),
      instructions: instructions.map(toPortableInstruction),
    })),
    cleanup: cleanup.map(toPortableInstruction),
    signers: planSigners([...planned.flat(), ...cleanup], owner),
  };
}

/** The owner's account holds a confidential balance under these keys (I-5) of at least the amount. */
function checkSource(input: {
  owner: Address;
  tokenAccount: Token;
  keys: ConfidentialKeyMaterial;
  amount: bigint;
}): bigint {
  if (input.amount <= 0n) throw new Error("the amount must be above zero");
  if (input.tokenAccount.owner !== input.owner) {
    throw new ConfidentialAccountError(
      "wrong_owner",
      "The token account belongs to another wallet",
    );
  }
  const source = confidentialExtension(input.tokenAccount);
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
  const { available } = decryptTokenAccount(input.tokenAccount, input.keys);
  if (available < input.amount) {
    throw new ConfidentialAccountError(
      "insufficient_balance",
      "The available confidential balance is below the amount",
    );
  }
  return available;
}

/** The helper reads rent for the accounts it creates, nothing else; anything else fails loudly. */
function rentRpc(rent: (space: bigint) => Promise<bigint>) {
  return {
    getMinimumBalanceForRentExemption: (space: bigint) => ({ send: () => rent(space) }),
    getAccountInfo: () => {
      throw new Error("the plan reads no accounts");
    },
  } as unknown as Rpc<GetMinimumBalanceForRentExemptionApi & GetAccountInfoApi>;
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
  assertRecipientCanReceive(input.destinationTokenAccount);
  const available = checkSource({
    owner: input.owner,
    tokenAccount: input.sourceTokenAccount,
    keys: input.keys,
    amount: input.amount,
  });
  const wallet: TransactionSigner = createNoopSigner(input.owner);
  // The mint account is given, so the helper reads only rent (through the caller).
  const rpc = rentRpc(input.rent);

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
    return {
      variant,
      ...(await packPlan(plan, input.owner, input.version)),
      availableBefore: available,
    };
  } finally {
    elgamalKeypair.free();
    secret.free();
    aesKey.free();
  }
}

/**
 * The source account after a transfer plan lands (facts K6): the available balance ciphertext of the
 * plan's equality proof (the verify instruction's data after the instruction byte: public key 32,
 * ciphertext 64, commitment 32 bytes) and the remaining balance encrypted with the AES key.
 */
function predictedSource(
  source: Token,
  plan: ConfidentialTransferPlan,
  remaining: bigint,
  keys: ConfidentialKeyMaterial,
): Token {
  const equality = plan.transactions
    .flatMap((transaction) => transaction.instructions)
    .find(
      (instruction) =>
        instruction.programAddress === ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS &&
        instruction.data[0] === ZkElGamalProofInstruction.VerifyCiphertextCommitmentEquality,
    );
  if (!equality || equality.data.length < 97) {
    throw new Error("the transfer plan has no equality proof to predict the next balance from");
  }
  const availableBalance = equality.data.slice(33, 97);
  const aesKey = AeKey.fromBytes(keys.aeKey);
  let decryptableAvailableBalance: Uint8Array;
  try {
    decryptableAvailableBalance = aesKey.encrypt(remaining).toBytes();
  } finally {
    aesKey.free();
  }
  if (source.extensions.__option !== "Some") throw new Error("the source has no extensions");
  return {
    ...source,
    extensions: {
      __option: "Some",
      value: source.extensions.value.map((extension) =>
        extension.__kind === "ConfidentialTransferAccount"
          ? { ...extension, availableBalance, decryptableAvailableBalance }
          : extension,
      ),
    },
  };
}

export type TransferChunkLine = {
  destinationToken: Address;
  destinationTokenAccount: Token;
  amount: bigint;
};

/**
 * 06 section 7 step 2 (step 2.3): the transfer plans of a payroll chunk, in order, each built against
 * the state the lines before it leave, so the whole chunk can be signed before any line is sent.
 * `availableBefore` of each plan is the balance its line starts from; `next` is the source state after
 * the last line, for an integrity check once the chunk has landed.
 */
export async function confidentialTransferChunk(input: {
  owner: Address;
  sourceToken: Address;
  sourceTokenAccount: Token;
  mint: Address;
  mintAccount: Mint;
  lines: readonly TransferChunkLine[];
  keys: ConfidentialKeyMaterial;
  version: TransactionVersionChoice;
  rent: (space: bigint) => Promise<bigint>;
}): Promise<{ plans: ConfidentialTransferPlan[]; availableAfter: bigint; next: Token }> {
  if (input.lines.length === 0) throw new Error("a chunk has at least one line");
  const plans: ConfidentialTransferPlan[] = [];
  let source = input.sourceTokenAccount;
  let available = 0n;
  for (const line of input.lines) {
    const plan = await confidentialTransferPlan({
      owner: input.owner,
      sourceToken: input.sourceToken,
      sourceTokenAccount: source,
      destinationToken: line.destinationToken,
      destinationTokenAccount: line.destinationTokenAccount,
      mint: input.mint,
      mintAccount: input.mintAccount,
      amount: line.amount,
      keys: input.keys,
      version: input.version,
      rent: input.rent,
    });
    available = plan.availableBefore - line.amount;
    source = predictedSource(source, plan, available, input.keys);
    plans.push(plan);
  }
  return { plans, availableAfter: available, next: source };
}

/**
 * 06 section 6, step 2 (AC-09.1; step 1.10): a withdraw of `amount` from the owner's available
 * confidential balance to the public wUSDC balance of the same account. The amount is public by
 * design (facts A2). Version 1 takes the range proof inline, version 0 stages it in a record account,
 * as for a transfer.
 */
export async function confidentialWithdrawPlan(input: {
  owner: Address;
  token: Address;
  tokenAccount: Token;
  mint: Address;
  decimals: number;
  amount: bigint;
  keys: ConfidentialKeyMaterial;
  version: TransactionVersionChoice;
  rent: (space: bigint) => Promise<bigint>;
}): Promise<ConfidentialTransferPlan> {
  const available = checkSource(input);
  const wallet: TransactionSigner = createNoopSigner(input.owner);
  const secret = ElGamalSecretKey.fromBytes(input.keys.elgamalSecretKey);
  const elgamalKeypair = ElGamalKeypair.fromSecretKey(secret);
  const aesKey = AeKey.fromBytes(input.keys.aeKey);
  try {
    const common = {
      token: input.token,
      mint: input.mint,
      tokenAccount: input.tokenAccount,
      authority: wallet,
      amount: input.amount,
      decimals: input.decimals,
      elgamalKeypair,
      aesKey,
      payer: wallet,
      rpc: rentRpc(input.rent),
    };
    const variant = input.version === 1 ? "inline" : "record";
    const plan =
      variant === "inline"
        ? await getConfidentialWithdrawInstructionPlan(common)
        : await getConfidentialWithdrawWithRecordInstructionPlan(common);
    return {
      variant,
      ...(await packPlan(plan, input.owner, input.version)),
      availableBefore: available,
    };
  } finally {
    elgamalKeypair.free();
    secret.free();
    aesKey.free();
  }
}
