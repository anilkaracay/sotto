// Messages between the page and the crypto Web Worker (04 section 5, 10 section 3). Requests carry
// wallet signatures as transferred buffers, and token account data the page read from chain.
// Responses carry public keys, status, balances decrypted for display and public instruction data
// (ciphertexts and proofs the transaction publishes onchain). No response type has a field for
// secret key material or a wallet signature, so none can leave the worker. Since step 1.9 the worker
// builds a confidential transfer plan and keeps the keypairs of the proof context and record accounts
// the plan creates; `cosign` answers with their transaction signatures, which the transaction
// publishes onchain anyway. For the rent of those accounts the worker asks the page (`rent`), which
// reads the chain: the worker makes no network calls.
import type { SendableTransaction } from "@sotto/sdk/confidential/public";
import type { PortableInstruction } from "@sotto/sdk/tx";

export type WorkerRequest =
  | { id: number; type: "unlock"; wallet: string; signature: ArrayBuffer }
  | { id: number; type: "checkAccount"; elgamalPubkey: string }
  | { id: number; type: "unlockViewing"; wallet: string; signature: ArrayBuffer }
  | { id: number; type: "status" }
  /** The determinism check before account setup: a second signature of the key message. */
  | { id: number; type: "confirmSignature"; wallet: string; signature: ArrayBuffer }
  | { id: number; type: "setupInstructions"; mint: string }
  | { id: number; type: "decrypt"; account: ArrayBuffer }
  | { id: number; type: "applyInstruction"; token: string; account: ArrayBuffer }
  /** Before the worker is terminated: zero every key, the viewing key and the signature digest. */
  | { id: number; type: "clear" }
  /** Step 1.8: canonical JSON sealed to a viewer's public key (no key of this tab needed). */
  | { id: number; type: "seal"; publicKey: ArrayBuffer; value: unknown }
  /** Step 1.8: a sealed box opened with this tab's viewing key. */
  | { id: number; type: "openSealed"; ciphertext: ArrayBuffer }
  /** Step 1.9: a confidential transfer plan from account data the page just read. */
  | {
      id: number;
      type: "transferPlan";
      sourceToken: string;
      sourceAccount: ArrayBuffer;
      destinationToken: string;
      destinationAccount: ArrayBuffer;
      mint: string;
      mintAccount: ArrayBuffer;
      /** Base units, as a decimal string. */
      amount: string;
      version: 0 | 1;
    }
  /** Step 1.10: a withdraw plan (available to public wUSDC) from the account data just read. */
  | {
      id: number;
      type: "withdrawPlan";
      token: string;
      account: ArrayBuffer;
      mint: string;
      decimals: number;
      /** Base units, as a decimal string. */
      amount: string;
      version: 0 | 1;
    }
  /** Step 1.9: the plan's own signatures over a transaction the wallet signed (wire bytes). */
  | { id: number; type: "cosign"; planId: string; transaction: ArrayBuffer }
  /** Step 1.9: drops the plan's keypairs once it is done. */
  | { id: number; type: "endPlan"; planId: string };

/** The page's answer to a rent question (step 1.9); no response follows it. */
export type RentReply = { type: "rentReply"; callId: number; lamports?: string; error?: string };

export type UnlockResult = { elgamalPubkey: string };
export type CheckAccountResult = { matches: boolean };
export type ViewingResult = { publicKey: string };
export type StatusResult = { wallet: string | null; unlocked: boolean; viewing: boolean };
/** Whether the second signature equals the one the keys came from. */
export type ConfirmSignatureResult = { same: boolean };
export type SetupInstructionsResult = { token: string; instructions: PortableInstruction[] };
/** Decrypted in the worker for display on this page only (base units). */
export type DecryptResult = {
  available: bigint;
  pending: bigint;
  pendingBalanceCreditCounter: bigint;
  maximumPendingBalanceCreditCounter: bigint;
};
export type ApplyInstructionResult = { instruction: PortableInstruction };
export type ClearResult = { cleared: true };
export type SealResult = { ciphertext: Uint8Array };
/** Opened for display on this page (for example a recipient's default amount). */
export type OpenSealedResult = { value: unknown };
export type TransferPlanResult = {
  planId: string;
  variant: "inline" | "record";
  transactions: SendableTransaction[];
  cleanup: PortableInstruction[];
  /** The addresses of the plan's own signers. */
  signers: string[];
  /** Base units, decrypted for the integrity check after settlement. */
  availableBefore: bigint;
};
export type CosignResult = { signatures: Record<string, Uint8Array> };
export type EndPlanResult = { ended: true };
export type WorkerResult =
  | UnlockResult
  | CheckAccountResult
  | ViewingResult
  | StatusResult
  | ConfirmSignatureResult
  | SetupInstructionsResult
  | DecryptResult
  | ApplyInstructionResult
  | ClearResult
  | SealResult
  | OpenSealedResult
  | TransferPlanResult
  | CosignResult
  | EndPlanResult;

export type WorkerErrorCode =
  | "bad_signature"
  | "not_unlocked"
  | "key_mismatch"
  | "not_confidential"
  | "wrong_owner"
  | "not_viewing"
  | "cannot_open"
  | "recipient_not_ready"
  | "insufficient_balance"
  | "no_plan"
  | "failed";

export type WorkerResponse =
  | { type: "ready" }
  /** Step 1.9: the worker asks the page for the rent exempt minimum of an account size. */
  | { type: "rent"; callId: number; space: string }
  | { id: number; ok: true; result: WorkerResult }
  | { id: number; ok: false; error: { code: WorkerErrorCode; message: string } };
