// Sends transactions signed by server side keypairs (worker, scripts, localnet tests) by the 06
// section 9 rules (prepare.ts), as version 0 or version 1, and waits for confirmation. Wallet signed
// transactions add the signed message check (signed-message.ts) in the browser path.
import {
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  signTransactionMessageWithSigners,
  type Instruction,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit";
import type { TransactionVersionChoice } from "./budget.ts";
import { decodeTransactionError } from "./errors.ts";
import { prepareTransaction, type PreparedTransaction } from "./prepare.ts";
import type { SolanaRpc } from "./rpc.ts";

export type Commitment = "confirmed" | "finalized";

export class TransactionFailedError extends Error {
  readonly signature: Signature;
  readonly err: unknown;
  constructor(signature: Signature, err: unknown, message: string) {
    super(`transaction ${signature} failed: ${message}`);
    this.name = "TransactionFailedError";
    this.signature = signature;
    this.err = err;
  }
}

/**
 * Waits until the signature reaches the commitment: `confirmed` for progress in the UI, `finalized`
 * for the settled state and for disclosures (06 section 9).
 */
export async function waitForConfirmation(
  rpc: SolanaRpc,
  signature: Signature,
  timeoutMs = 60_000,
  commitment: Commitment = "confirmed",
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) {
      throw new TransactionFailedError(
        signature,
        status.err,
        decodeTransactionError(status.err).message,
      );
    }
    const reached =
      status?.confirmationStatus === "finalized" ||
      (commitment === "confirmed" && status?.confirmationStatus === "confirmed");
    if (reached) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `transaction ${signature} was not ${commitment} within ${timeoutMs / 1000} seconds`,
  );
}

export type SendResult = PreparedTransaction & {
  signature: Signature;
  /** The same values as before this step, kept for callers of step 1.1. */
  computeUnitLimit: number;
  computeUnitPrice: bigint;
};

export async function sendWithKeypairSigners(options: {
  rpc: SolanaRpc;
  feePayer: KeyPairSigner;
  instructions: readonly Instruction[];
  version?: TransactionVersionChoice;
  priorityFeeCapMicroLamports?: bigint;
  confirmTimeoutMs?: number;
  /** Waits for `finalized` after `confirmed` (the settled state). */
  finalize?: boolean;
}): Promise<SendResult> {
  const { rpc } = options;
  const { message, prepared } = await prepareTransaction({
    rpc,
    version: options.version ?? 0,
    feePayer: options.feePayer,
    instructions: options.instructions,
    ...(options.priorityFeeCapMicroLamports === undefined
      ? {}
      : { priorityFeeCapMicroLamports: options.priorityFeeCapMicroLamports }),
  });
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  await rpc
    .sendTransaction(getBase64EncodedWireTransaction(signed), {
      encoding: "base64",
      preflightCommitment: "confirmed",
    })
    .send();
  await waitForConfirmation(rpc, signature, options.confirmTimeoutMs, "confirmed");
  if (options.finalize) {
    await waitForConfirmation(rpc, signature, options.confirmTimeoutMs ?? 90_000, "finalized");
  }
  return {
    ...prepared,
    signature,
    computeUnitLimit: prepared.budget.computeUnitLimit,
    computeUnitPrice: prepared.budget.computeUnitPrice,
  };
}
