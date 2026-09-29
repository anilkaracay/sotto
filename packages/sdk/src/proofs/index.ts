// `@sotto/sdk/proofs` (step 2.7): the TypeScript client of `sotto_proofs` (docs/05-ONCHAIN-PROGRAM.md),
// generated with Codama from the hand written IDL (`scripts/proofs-idl.ts`, D-16), and the pieces of
// the proof of funds flow of 06 section 8 that the program fixes: the proofs of "available balance at
// least X" and their context accounts, taken from the token-2022 withdraw plan for X (facts K2); the
// record nonce; the counterparty hash of X-32; and the compute budget of the instruction. The UI flow
// is step 2.8.
import { getAddressDecoder, type Address } from "@solana/kit";
import {
  confidentialWithdrawPlan,
  type ConfidentialTransferPlan,
} from "../confidential/transfer.ts";
import type { Token } from "@solana-program/token-2022";
import type { ConfidentialKeyMaterial } from "../keys/index.ts";
import type { PortableInstruction } from "../tx/portable.ts";
import { findProgramDataPda, findProofRecordPda } from "./generated/index.ts";

export * from "./generated/index.ts";

/**
 * The compute unit limit of a transaction holding only `verify_balance_threshold` with a nonce from
 * `recordNonce`: the instruction's cost on the Agave runtime (13142 units, facts N2) plus 20 percent,
 * rounded up (05 section 6). Sotto's transactions take their limit from their own simulation plus 20
 * percent (06 section 9); this bound is for a transaction that cannot be simulated before signing.
 */
export const VERIFY_BALANCE_THRESHOLD_COMPUTE_UNITS = 16_000;

const ZK_ELGAMAL_PROOF_PROGRAM = "ZkE1Gama1Proof11111111111111111111111111111";
/** `ProofInstruction` of the ZK ElGamal Proof program (facts K1). */
const VERIFY_CIPHERTEXT_COMMITMENT_EQUALITY = 3;
const VERIFY_BATCHED_RANGE_PROOF_U64 = 6;
/** Instruction data of a verification that reads its proof from an account: the byte and a u32. */
const FROM_ACCOUNT_DATA_LENGTH = 5;

/** The ProgramData account of a program under the upgradeable loader (initialize_config needs it). */
export async function programDataAddress(program: Address): Promise<Address> {
  const [address] = await findProgramDataPda({ program });
  return address;
}

/** 16 random bytes: the nonce of a proof record's address, or the salt of X-32. */
export function randomBytes16(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

/**
 * A record nonce whose record address has bump 255, so the program's address search takes one try
 * and the instruction costs the same every time (each further try costs about 1500 compute units,
 * facts N2). Half of all nonces qualify.
 */
export async function recordNonce(
  tokenAccount: Address,
  programAddress: Address,
): Promise<Uint8Array> {
  for (;;) {
    const nonce = randomBytes16();
    const [, bump] = await findProofRecordPda({ tokenAccount, nonce }, { programAddress });
    if (bump === 255) return nonce;
  }
}

/** X-32: SHA-256 of the 16 byte salt followed by the UTF-8 label. Salt and label stay offchain. */
export async function counterpartyHash(salt: Uint8Array, label: string): Promise<Uint8Array> {
  if (salt.length !== 16) throw new Error("the counterparty salt is 16 bytes");
  const labelBytes = new TextEncoder().encode(label);
  const input = new Uint8Array(16 + labelBytes.length);
  input.set(salt);
  input.set(labelBytes, 16);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
}

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

/** The equality and range context accounts that verification instructions write. */
export function contextAccounts(instructions: readonly PortableInstruction[]): {
  equalityContext: Address;
  rangeContext: Address;
} {
  const found: Partial<Record<number, Address>> = {};
  for (const instruction of instructions) {
    if (instruction.programAddress !== ZK_ELGAMAL_PROOF_PROGRAM) continue;
    const kind = instruction.data[0];
    if (kind !== VERIFY_CIPHERTEXT_COMMITMENT_EQUALITY && kind !== VERIFY_BATCHED_RANGE_PROOF_U64) {
      continue;
    }
    // Inline proof data: the context is the first account; proof data in an account: the second.
    const index = instruction.data.length === FROM_ACCOUNT_DATA_LENGTH ? 1 : 0;
    const context = instruction.accounts[index]?.address;
    if (context) found[kind] = context;
  }
  const equalityContext = found[VERIFY_CIPHERTEXT_COMMITMENT_EQUALITY];
  const rangeContext = found[VERIFY_BATCHED_RANGE_PROOF_U64];
  if (!equalityContext || !rangeContext) {
    throw new Error("the plan does not verify an equality and a range proof into context accounts");
  }
  return { equalityContext, rangeContext };
}

/** The `ProofVerified` event's fields as the program logs them (05 section 4.3, check 10). */
export type ProofVerifiedEvent = {
  record: Address;
  tokenAccount: Address;
  owner: Address;
  threshold: bigint;
  slot: bigint;
  expiry: bigint;
};

/** The `ProofVerified` event from a transaction's log messages, or null. */
export function proofVerifiedEvent(logs: readonly string[]): ProofVerifiedEvent | null {
  const decoder = getAddressDecoder();
  for (const line of logs) {
    if (!line.startsWith("Program data: ")) continue;
    const fields = line
      .slice("Program data: ".length)
      .split(" ")
      .map((field) => Uint8Array.from(atob(field), (char) => char.charCodeAt(0)));
    if (fields.length !== 7 || new TextDecoder().decode(fields[0]) !== "ProofVerified") continue;
    const [, record, token, owner, threshold, slot, expiry] = fields as [
      Uint8Array,
      Uint8Array,
      Uint8Array,
      Uint8Array,
      Uint8Array,
      Uint8Array,
      Uint8Array,
    ];
    const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return {
      record: decoder.decode(record),
      tokenAccount: decoder.decode(token),
      owner: decoder.decode(owner),
      threshold: view(threshold).getBigUint64(0, true),
      slot: view(slot).getBigUint64(0, true),
      expiry: view(expiry).getBigInt64(0, true),
    };
  }
  return null;
}
