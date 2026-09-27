// Messages between the page and the crypto Web Worker (04 section 5, 10 section 3). Requests carry
// wallet signatures as transferred buffers, and token account data the page read from chain.
// Responses carry public keys, status, balances decrypted for display and public instruction data
// (ciphertexts and proofs the transaction publishes onchain). No response type has a field for
// secret key material or a signature, so none can leave the worker.
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
  | { id: number; type: "clear" };

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
export type WorkerResult =
  | UnlockResult
  | CheckAccountResult
  | ViewingResult
  | StatusResult
  | ConfirmSignatureResult
  | SetupInstructionsResult
  | DecryptResult
  | ApplyInstructionResult
  | ClearResult;

export type WorkerErrorCode =
  "bad_signature" | "not_unlocked" | "key_mismatch" | "not_confidential" | "wrong_owner" | "failed";

export type WorkerResponse =
  | { type: "ready" }
  | { id: number; ok: true; result: WorkerResult }
  | { id: number; ok: false; error: { code: WorkerErrorCode; message: string } };
