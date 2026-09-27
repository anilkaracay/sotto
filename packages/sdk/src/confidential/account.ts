// The owner's wUSDC token account with the confidential keys (06 sections 3 and 4, AC-03.3, AC-03.4,
// AC-04.3): the instructions that create it and configure it for Confidential Balances, the apply
// instruction and the decryption of its balances. They need the confidential keys (the pubkey validity
// proof, the encrypted balances), so they run where the keys live: the crypto worker, or a keypair in
// tests and scripts. The owner's wallet signs the transaction afterwards. The public state and the
// deposit, which need no keys, are in state.ts.
import type { Token } from "@solana-program/token-2022";
import {
  decryptConfidentialTransferBalance,
  getApplyConfidentialPendingBalanceInstructionFromToken,
  getCreateConfidentialTransferAccountInstructionPlan,
} from "@solana-program/token-2022/confidential";
import {
  flattenInstructionPlan,
  isNonDivisibleSequentialInstructionPlan,
  type Address,
  type GetMinimumBalanceForRentExemptionApi,
  type Rpc,
  type TransactionSigner,
} from "@solana/kit";
import { AeKey, ElGamalKeypair, ElGamalSecretKey } from "@solana/zk-sdk/bundler";
import { elgamalKeyMatches, type ConfidentialKeyMaterial } from "../keys/confidential.ts";
import { toPortableInstruction, type PortableInstruction } from "../tx/portable.ts";
import {
  associatedTokenAccount,
  ConfidentialAccountError,
  confidentialExtension,
} from "./state.ts";

/**
 * The plan helper takes an RPC for proof context accounts, which account setup does not create
 * (@solana-program/zk-elgamal-proof 0.4.0 verifyPubkeyValidity reads it only with a context state).
 * If a later version asks, this fails loudly instead of reaching the network from the worker.
 */
const NO_RPC = {
  getMinimumBalanceForRentExemption() {
    throw new Error("account setup makes no RPC calls");
  },
} as unknown as Rpc<GetMinimumBalanceForRentExemptionApi>;

/** Runs `use` with the zk-sdk key objects and frees them afterwards. */
function withKeys<T>(
  keys: ConfidentialKeyMaterial,
  use: (secret: ElGamalSecretKey, aesKey: AeKey) => T,
): T {
  const secret = ElGamalSecretKey.fromBytes(keys.elgamalSecretKey);
  const aesKey = AeKey.fromBytes(keys.aeKey);
  try {
    return use(secret, aesKey);
  } finally {
    secret.free();
    aesKey.free();
  }
}

/**
 * 06 section 3, steps 1 to 3: create the owner's associated wUSDC account if missing (idempotent, the
 * owner pays), reallocate it for the ConfidentialTransferAccount extension, configure it with the
 * owner's ElGamal key and an encrypted zero balance, and verify the pubkey validity proof. The
 * instructions must go in one transaction, in this order (the configure instruction reads the proof
 * one instruction later). The owner is a placeholder signer here; the owner's wallet signs the
 * compiled transaction.
 */
export async function confidentialAccountSetupInstructions(input: {
  owner: TransactionSigner;
  mint: Address;
  keys: ConfidentialKeyMaterial;
  /** Defaults to the client's default maximum (65536). Tests set a small value. */
  maximumPendingBalanceCreditCounter?: bigint;
}): Promise<{ token: Address; instructions: PortableInstruction[] }> {
  const token = await associatedTokenAccount(input.owner.address, input.mint);
  const secret = ElGamalSecretKey.fromBytes(input.keys.elgamalSecretKey);
  const elgamalKeypair = ElGamalKeypair.fromSecretKey(secret);
  const aesKey = AeKey.fromBytes(input.keys.aeKey);
  try {
    const plan = await getCreateConfidentialTransferAccountInstructionPlan({
      payer: input.owner,
      owner: input.owner,
      mint: input.mint,
      token,
      rpc: NO_RPC,
      elgamalKeypair,
      aesKey,
      ...(input.maximumPendingBalanceCreditCounter === undefined
        ? {}
        : { maximumPendingBalanceCreditCounter: input.maximumPendingBalanceCreditCounter }),
    });
    if (!isNonDivisibleSequentialInstructionPlan(plan)) {
      throw new Error("the account setup plan must be one non divisible sequence");
    }
    const instructions = flattenInstructionPlan(plan).map((step) => {
      if (step.kind !== "single") throw new Error("the account setup plan must be instructions");
      return toPortableInstruction(step.instruction);
    });
    return { token, instructions };
  } finally {
    elgamalKeypair.free();
    secret.free();
    aesKey.free();
  }
}

export type DecryptedBalance = {
  /** Decrypted from the decryptable available balance with the AES key (facts A4). */
  available: bigint;
  /** Decrypted from the pending balance with the ElGamal secret key. */
  pending: bigint;
  pendingBalanceCreditCounter: bigint;
  maximumPendingBalanceCreditCounter: bigint;
};

/**
 * Decrypts a decoded token account's confidential balances, only after its ElGamal key matches the
 * derived one (I-5). Call it where the keys live.
 */
export function decryptTokenAccount(token: Token, keys: ConfidentialKeyMaterial): DecryptedBalance {
  const extension = confidentialExtension(token);
  if (!extension) {
    throw new ConfidentialAccountError(
      "not_confidential",
      "The token account has no confidential balance",
    );
  }
  if (!elgamalKeyMatches(keys.elgamalPubkey, extension.elgamalPubkey)) {
    throw new ConfidentialAccountError(
      "key_mismatch",
      "The keys this wallet derives do not match the account's ElGamal key: wrong wallet or keys other than the standard ones",
    );
  }
  return withKeys(keys, (elgamalSecretKey, aesKey) => {
    const balance = decryptConfidentialTransferBalance({
      tokenAccount: token,
      elgamalSecretKey,
      aesKey,
    });
    return {
      available: balance.availableBalance,
      pending: balance.pendingBalance,
      pendingBalanceCreditCounter: balance.pendingBalanceCreditCounter,
      maximumPendingBalanceCreditCounter: balance.maximumPendingBalanceCreditCounter,
    };
  });
}

/**
 * 06 section 4, step 3: moves the pending balance into the available balance. It reads the account
 * state it is given, so the caller passes fresh state (read just before). No proofs.
 */
export function applyPendingBalanceInstruction(input: {
  token: Address;
  tokenAccount: Token;
  owner: TransactionSigner;
  keys: ConfidentialKeyMaterial;
}): PortableInstruction {
  const extension = confidentialExtension(input.tokenAccount);
  if (!extension) {
    throw new ConfidentialAccountError(
      "not_confidential",
      "The token account has no confidential balance",
    );
  }
  if (!elgamalKeyMatches(input.keys.elgamalPubkey, extension.elgamalPubkey)) {
    throw new ConfidentialAccountError(
      "key_mismatch",
      "The keys this wallet derives do not match the account's ElGamal key",
    );
  }
  return withKeys(input.keys, (elgamalSecretKey, aesKey) =>
    toPortableInstruction(
      getApplyConfidentialPendingBalanceInstructionFromToken({
        token: input.token,
        tokenAccount: input.tokenAccount,
        authority: input.owner,
        elgamalSecretKey,
        aesKey,
      }),
    ),
  );
}
