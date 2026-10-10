// Sends a transaction the user's wallet signs (06 section 9, the browser path of step 1.7). The
// transaction is prepared by the rules (prepare.ts) and signed through the wallet's modifying signer
// (@solana/react useWalletAccountTransactionSigner). Then the signed message check
// (signed-message.ts) decides, before anything is sent:
// - identical: send;
// - different only in ComputeBudget instructions (or the v1 budget config): send, after the caller
//   has recorded the wallet name and the changed values (never amounts);
// - anything else: refuse with "Your wallet changed this transaction. It was not sent."
// The caller hears every comparison through onSignedMessage, so the wallet name reaches the log in
// each case (the check itself never looks at the wallet name, D-26). Since step 1.9 a transaction can
// need other signers too (the proof context and record accounts a confidential transfer creates):
// `cosign` adds their signatures to the message the wallet returned, after the check, so a budget
// change by the wallet cannot invalidate them.
import {
  assertIsFullySignedTransaction,
  assertIsTransactionWithinSizeLimit,
  compileTransaction,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type Address,
  type Instruction,
  type SignatureBytes,
  type Transaction,
  type TransactionModifyingSigner,
} from "@solana/kit";
import type { TransactionVersionChoice } from "./budget.ts";
import { prepareTransaction } from "./prepare.ts";
import { RpcTimeoutError, type SolanaRpc } from "./rpc.ts";
import { waitForConfirmation, type SendResult } from "./send-keypair.ts";
import {
  compareSignedMessage,
  WALLET_CHANGED_TRANSACTION,
  type SignedMessageComparison,
} from "./signed-message.ts";

export class WalletChangedTransactionError extends Error {
  /** What changed, for the log (for example "instruction 2: the data"). */
  readonly reason: string;
  constructor(reason: string) {
    super(WALLET_CHANGED_TRANSACTION);
    this.name = "WalletChangedTransactionError";
    this.reason = reason;
  }
}

/**
 * The wallet raised an error instead of signing (step 2.1). The transaction had passed Sotto's
 * simulation, so the refusal is the wallet's; `cause` is the wallet's own error, which the page shows
 * with the wallet's name next to its explanation.
 */
export class WalletSigningError extends Error {
  constructor(cause: unknown) {
    super("the wallet did not sign the transaction", { cause });
    this.name = "WalletSigningError";
  }
}

export type WalletSendResult = SendResult & { comparison: SignedMessageComparison };

export async function sendWithWallet(options: {
  rpc: SolanaRpc;
  wallet: TransactionModifyingSigner;
  instructions: readonly Instruction[];
  version: TransactionVersionChoice;
  /**
   * Hears the signed message check of every signature before anything is sent; the page records the
   * budget changes and refusals with the wallet name (06 section 9).
   */
  onSignedMessage?: (comparison: SignedMessageComparison) => void | Promise<void>;
  priorityFeeCapMicroLamports?: bigint;
  confirmTimeoutMs?: number;
  /** Waits for `finalized` after `confirmed` (the settled state). */
  finalize?: boolean;
  /** Signatures of the other signers the message needs, over the message the wallet signed. */
  cosign?: (transaction: Transaction) => Promise<Readonly<Record<Address, SignatureBytes>>>;
  /** Hears the signature before the transaction is sent (the executions record, 08 section 3). */
  onSignature?: (signature: string) => void | Promise<void>;
}): Promise<WalletSendResult> {
  const { rpc, wallet } = options;
  const { message, prepared } = await prepareTransaction({
    rpc,
    version: options.version,
    feePayer: wallet.address,
    instructions: options.instructions,
    ...(options.priorityFeeCapMicroLamports === undefined
      ? {}
      : { priorityFeeCapMicroLamports: options.priorityFeeCapMicroLamports }),
  });
  const built = compileTransaction(message);
  let walletSigned:
    Awaited<ReturnType<typeof wallet.modifyAndSignTransactions>>[number] | undefined;
  try {
    [walletSigned] = await wallet.modifyAndSignTransactions([built]);
  } catch (error) {
    throw new WalletSigningError(error);
  }
  if (!walletSigned) throw new Error("the wallet returned no signed transaction");
  const comparison = compareSignedMessage(built.messageBytes, walletSigned.messageBytes);
  await options.onSignedMessage?.(comparison);
  if (comparison.kind === "changed") throw new WalletChangedTransactionError(comparison.reason);
  const signed = options.cosign
    ? {
        ...walletSigned,
        signatures: { ...walletSigned.signatures, ...(await options.cosign(walletSigned)) },
      }
    : walletSigned;
  assertIsFullySignedTransaction(signed);
  assertIsTransactionWithinSizeLimit(signed);
  const signature = getSignatureFromTransaction(signed);
  await options.onSignature?.(signature);
  try {
    await rpc
      .sendTransaction(getBase64EncodedWireTransaction(signed), {
        encoding: "base64",
        preflightCommitment: "confirmed",
      })
      .send();
  } catch (error) {
    // Step 4.9: with no answer to the send, the network may still have the transaction. It is not
    // sent twice; the wait below tells whether it landed.
    if (!(error instanceof RpcTimeoutError)) throw error;
  }
  await waitForConfirmation(rpc, signature, options.confirmTimeoutMs, "confirmed");
  if (options.finalize) {
    await waitForConfirmation(rpc, signature, options.confirmTimeoutMs ?? 90_000, "finalized");
  }
  return {
    ...prepared,
    signature,
    computeUnitLimit: prepared.budget.computeUnitLimit,
    computeUnitPrice: prepared.budget.computeUnitPrice,
    comparison,
  };
}
