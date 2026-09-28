// Sending a confidential transfer (06 section 5, AC-06.4, AC-06.5; step 1.9). No keys: the page and
// tests send the transactions the transfer plan made (transfer.ts), in order, each after the previous
// one confirmed, the transfer itself up to `finalized`. A failure names the step that failed. If the
// transfer does not complete, closeProofAccounts closes the proof context and record accounts that
// exist, with their rent to the fee payer, so nothing is left behind and the balances are unchanged.
import {
  fetchEncodedAccounts,
  type Address,
  type SignatureBytes,
  type Transaction,
  type TransactionModifyingSigner,
} from "@solana/kit";
import type { TransactionVersionChoice } from "../tx/budget.ts";
import { fromPortableInstruction } from "../tx/plan.ts";
import type { PortableInstruction } from "../tx/portable.ts";
import type { SolanaRpc } from "../tx/rpc.ts";
import { sendWithWallet } from "../tx/send-wallet.ts";
import type { SignedMessageComparison } from "../tx/signed-message.ts";
import { measureTransaction } from "../tx/size.ts";

export type TransferTransactionRole = "proof" | "transfer" | "cleanup";

export type SendableTransaction = {
  role: TransferTransactionRole;
  instructions: PortableInstruction[];
};

type Cosign = (transaction: Transaction) => Promise<Readonly<Record<Address, SignatureBytes>>>;

export class TransferStepError extends Error {
  /** The transaction that failed, from 0, and what it was for. */
  readonly index: number;
  readonly role: TransferTransactionRole;
  /** Every signature handed out so far, the failed transaction's included when it had one. */
  readonly signatures: string[];
  constructor(index: number, role: TransferTransactionRole, cause: unknown, signatures: string[]) {
    super(`transaction ${index + 1} (${role}) failed`, { cause });
    this.name = "TransferStepError";
    this.index = index;
    this.role = role;
    this.signatures = signatures;
  }
}

export async function sendTransferTransactions(options: {
  rpc: SolanaRpc;
  wallet: TransactionModifyingSigner;
  version: TransactionVersionChoice;
  transactions: readonly SendableTransaction[];
  cosign?: Cosign;
  onSignedMessage?: (comparison: SignedMessageComparison) => void | Promise<void>;
  /** Before each transaction is prepared (the page shows the step). */
  onStep?: (index: number, role: TransferTransactionRole) => void | Promise<void>;
  /** Each signature before its transaction is sent (the executions record). */
  onSignature?: (
    index: number,
    role: TransferTransactionRole,
    signature: string,
  ) => void | Promise<void>;
  confirmTimeoutMs?: number;
}): Promise<{ signatures: string[]; transferSignature: string }> {
  const signatures: string[] = [];
  let transferSignature: string | null = null;
  for (const [index, transaction] of options.transactions.entries()) {
    try {
      await options.onStep?.(index, transaction.role);
      const sent = await sendWithWallet({
        rpc: options.rpc,
        wallet: options.wallet,
        version: options.version,
        instructions: transaction.instructions.map(fromPortableInstruction),
        finalize: transaction.role === "transfer",
        ...(options.cosign ? { cosign: options.cosign } : {}),
        ...(options.onSignedMessage ? { onSignedMessage: options.onSignedMessage } : {}),
        ...(options.confirmTimeoutMs === undefined
          ? {}
          : { confirmTimeoutMs: options.confirmTimeoutMs }),
        onSignature: async (signature) => {
          signatures.push(signature);
          await options.onSignature?.(index, transaction.role, signature);
        },
      });
      if (transaction.role === "transfer") transferSignature = sent.signature;
    } catch (error) {
      throw new TransferStepError(index, transaction.role, error, [...signatures]);
    }
  }
  if (!transferSignature) throw new Error("the transfer plan had no transfer transaction");
  return { signatures, transferSignature };
}

/**
 * 06 section 5 failure handling: closes the proof context and record accounts of a transfer plan that
 * exist onchain (each closing instruction names its account first), packed into as few transactions
 * as fit, rent to the fee payer as the plan set it.
 */
export async function closeProofAccounts(options: {
  rpc: SolanaRpc;
  wallet: TransactionModifyingSigner;
  version: TransactionVersionChoice;
  cleanup: readonly PortableInstruction[];
  cosign?: Cosign;
  onSignedMessage?: (comparison: SignedMessageComparison) => void | Promise<void>;
  onSignature?: (signature: string) => void | Promise<void>;
}): Promise<{ closed: Address[]; signatures: string[] }> {
  const targets = options.cleanup.map((instruction) => {
    const target = instruction.accounts[0]?.address;
    if (!target) throw new Error("a closing instruction names no account");
    return target;
  });
  const accounts = await fetchEncodedAccounts(options.rpc, targets, { commitment: "confirmed" });
  const pending = options.cleanup.filter((_, index) => accounts[index]?.exists === true);
  const batches: PortableInstruction[][] = [];
  for (const instruction of pending) {
    const current = batches.at(-1);
    const candidate = [...(current ?? []), instruction];
    const fits = measureTransaction({
      feePayer: options.wallet.address,
      instructions: candidate.map(fromPortableInstruction),
      version: options.version,
    }).fits;
    if (current && fits) current.push(instruction);
    else batches.push([instruction]);
  }
  const signatures: string[] = [];
  for (const batch of batches) {
    const sent = await sendWithWallet({
      rpc: options.rpc,
      wallet: options.wallet,
      version: options.version,
      instructions: batch.map(fromPortableInstruction),
      ...(options.cosign ? { cosign: options.cosign } : {}),
      ...(options.onSignedMessage ? { onSignedMessage: options.onSignedMessage } : {}),
      ...(options.onSignature ? { onSignature: options.onSignature } : {}),
    });
    signatures.push(sent.signature);
  }
  return {
    closed: pending.map((instruction) => instruction.accounts[0]?.address as Address),
    signatures,
  };
}
