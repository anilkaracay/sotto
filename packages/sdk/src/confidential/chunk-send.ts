// Sending a payroll chunk (06 sections 7 and 9, D-21; step 2.3). No keys: the crypto worker built the
// chunk's transfer plans, each against the state the lines before it leave (transfer.ts,
// confidentialTransferChunk); this module signs and sends them.
// - Signing: one wallet call signs every transaction of the chunk (`modifyAndSignTransactions` with all
//   of them; the browser signer makes that one Wallet Standard signTransaction call). Each signed
//   message passes the check of 06 section 9 before anything is sent. With `signing: "each"` (the
//   fallback for a wallet that fails the batch call, D-26) every transaction is prepared, simulated
//   and signed on its own right before it is sent, as for a single payment.
// - Budgets: every transaction is budgeted from a simulation. The batch's first transaction is
//   simulated when it is prepared; the others cannot be yet, because they depend on transactions ahead
//   of them that have not landed, so they take the budget measured for the same shape of transaction
//   earlier in the run (BudgetMemory). A first line whose later transactions were never measured (the
//   version 0 path's first line: its transactions depend on each other) is sent transaction by
//   transaction first, each simulated before its own signature, and measures them for the rest.
// - Sending: the lines in order, each transaction confirmed before the next. Each signed transaction
//   is simulated again right before it is sent, with its own blockhash and signatures, so nothing that
//   would fail is sent, and its signature goes to the caller (the executions record) before it is
//   sent. A line starts only while the chunk's blockhash has blocks left for all its transactions;
//   otherwise the chunk ends there and the caller prepares the remaining lines again.
import {
  assertIsFullySignedTransaction,
  assertIsTransactionWithinSizeLimit,
  compileTransaction,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type Address,
  type SignatureBytes,
  type Transaction,
  type TransactionModifyingSigner,
} from "@solana/kit";
import type { TransactionVersionChoice } from "../tx/budget.ts";
import { fromPortableInstruction } from "../tx/plan.ts";
import type { PortableInstruction } from "../tx/portable.ts";
import { measuredBudgetOf, prepareTransaction, type MeasuredBudget } from "../tx/prepare.ts";
import type { SolanaRpc } from "../tx/rpc.ts";
import { waitForConfirmation } from "../tx/send-keypair.ts";
import {
  sendWithWallet,
  WalletChangedTransactionError,
  WalletSigningError,
} from "../tx/send-wallet.ts";
import { compareSignedMessage, type SignedMessageComparison } from "../tx/signed-message.ts";
import { SimulationFailedError, simulateSigned } from "../tx/simulate.ts";
import type { SendableTransaction, TransferTransactionRole } from "./transfer-send.ts";

type Cosign = (transaction: Transaction) => Promise<Readonly<Record<Address, SignatureBytes>>>;

/** Blocks a line needs per transaction to land and confirm, plus a margin, before it starts. */
export const BLOCKS_PER_TRANSACTION = 6n;
export const BLOCK_MARGIN = 10n;

export type ChunkLine = {
  transactions: readonly SendableTransaction[];
  /** The plan's own signatures (the proof accounts it creates) over what the wallet signed. */
  cosign?: Cosign;
};

/**
 * Budgets from simulations, by transaction shape: the version and, per instruction, the program,
 * the number of accounts and the length of the data. Lines of a run have the same shapes.
 */
export class BudgetMemory {
  readonly #budgets = new Map<string, MeasuredBudget>();

  static shapeOf(
    version: TransactionVersionChoice,
    instructions: readonly PortableInstruction[],
  ): string {
    return [
      `v${version}`,
      ...instructions.map(
        (instruction) =>
          `${instruction.programAddress}:${instruction.accounts.length}:${instruction.data.length}`,
      ),
    ].join("|");
  }

  get(
    version: TransactionVersionChoice,
    instructions: readonly PortableInstruction[],
  ): MeasuredBudget | undefined {
    return this.#budgets.get(BudgetMemory.shapeOf(version, instructions));
  }

  set(
    version: TransactionVersionChoice,
    instructions: readonly PortableInstruction[],
    budget: MeasuredBudget,
  ): void {
    this.#budgets.set(BudgetMemory.shapeOf(version, instructions), budget);
  }

  get size(): number {
    return this.#budgets.size;
  }
}

/** A transaction of a chunk failed or was stopped before it was sent. */
export class ChunkStepError extends Error {
  /** The line within the chunk, from 0, and the transaction within the line. */
  readonly line: number;
  readonly index: number;
  readonly role: TransferTransactionRole;
  /** Whether the failed transaction was handed to the network. */
  readonly sent: boolean;
  /** The line's signatures handed out so far, the failed transaction's included when it was sent. */
  readonly signatures: string[];
  constructor(
    line: number,
    index: number,
    role: TransferTransactionRole,
    cause: unknown,
    sent: boolean,
    signatures: string[],
  ) {
    super(`line ${line + 1}, transaction ${index + 1} (${role}) failed`, { cause });
    this.name = "ChunkStepError";
    this.line = line;
    this.index = index;
    this.role = role;
    this.sent = sent;
    this.signatures = signatures;
  }
}

export type LandedLine = { line: number; signatures: string[]; transferSignature: string };

export type ChunkResult = {
  /** Lines whose transactions all confirmed, in order. */
  landed: LandedLine[];
  /** Lines never started because the chunk's blockhash ran low; nothing of them was sent. */
  unsent: number[];
  /** Wallet signature requests the chunk made. */
  prompts: number;
};

type Options = {
  rpc: SolanaRpc;
  wallet: TransactionModifyingSigner;
  version: TransactionVersionChoice;
  lines: readonly ChunkLine[];
  budgets: BudgetMemory;
  /** "batch": one wallet call for the chunk; "each": one per transaction, just in time. */
  signing?: "batch" | "each";
  onSignedMessage?: (comparison: SignedMessageComparison) => void | Promise<void>;
  /** Before each transaction is sent. */
  onStep?: (line: number, index: number, role: TransferTransactionRole) => void | Promise<void>;
  /** Each signature before its transaction is sent; if it throws, nothing more is sent. */
  onSignature?: (
    line: number,
    index: number,
    role: TransferTransactionRole,
    signature: string,
  ) => void | Promise<void>;
  onLineLanded?: (landed: LandedLine) => void | Promise<void>;
  confirmTimeoutMs?: number;
  priorityFeeCapMicroLamports?: bigint;
};

function transferOf(line: number, signatures: string[], transfer: string | null): LandedLine {
  if (!transfer) throw new Error("a payroll line has a transfer transaction");
  return { line, signatures, transferSignature: transfer };
}

/** One line transaction by transaction, each prepared, simulated and signed right before it is sent. */
async function sendEach(options: Options, line: number): Promise<LandedLine> {
  const chunkLine = options.lines[line];
  if (!chunkLine) throw new Error("no such line");
  const signatures: string[] = [];
  let transfer: string | null = null;
  for (const [index, transaction] of chunkLine.transactions.entries()) {
    let handedOut = false;
    try {
      await options.onStep?.(line, index, transaction.role);
      const sent = await sendWithWallet({
        rpc: options.rpc,
        wallet: options.wallet,
        version: options.version,
        instructions: transaction.instructions.map(fromPortableInstruction),
        ...(chunkLine.cosign ? { cosign: chunkLine.cosign } : {}),
        ...(options.onSignedMessage ? { onSignedMessage: options.onSignedMessage } : {}),
        ...(options.confirmTimeoutMs === undefined
          ? {}
          : { confirmTimeoutMs: options.confirmTimeoutMs }),
        ...(options.priorityFeeCapMicroLamports === undefined
          ? {}
          : { priorityFeeCapMicroLamports: options.priorityFeeCapMicroLamports }),
        onSignature: async (signature) => {
          await options.onSignature?.(line, index, transaction.role, signature);
          handedOut = true;
          signatures.push(signature);
        },
      });
      options.budgets.set(options.version, transaction.instructions, measuredBudgetOf(sent));
      if (transaction.role === "transfer") transfer = sent.signature;
    } catch (error) {
      throw new ChunkStepError(line, index, transaction.role, error, handedOut, [...signatures]);
    }
  }
  return transferOf(line, signatures, transfer);
}

type Prepared = {
  line: number;
  index: number;
  role: TransferTransactionRole;
  programs: Address[];
  built: ReturnType<typeof compileTransaction>;
};

export async function sendTransferChunk(options: Options): Promise<ChunkResult> {
  const { rpc, wallet, version, lines, budgets } = options;
  const landed: LandedLine[] = [];
  let prompts = 0;

  const land = async (result: LandedLine) => {
    landed.push(result);
    await options.onLineLanded?.(result);
  };

  if (options.signing === "each") {
    for (let line = 0; line < lines.length; line++) {
      await land(await sendEach(options, line));
      prompts += lines[line]?.transactions.length ?? 0;
    }
    return { landed, unsent: [], prompts };
  }

  // A first line with transactions no simulation has measured goes first, one by one.
  let start = 0;
  const first = lines[0];
  if (
    first &&
    first.transactions.some(
      (transaction, index) => index > 0 && !budgets.get(version, transaction.instructions),
    )
  ) {
    await land(await sendEach(options, 0));
    prompts += first.transactions.length;
    start = 1;
  }
  if (start >= lines.length) return { landed, unsent: [], prompts };

  // One blockhash for the batch. Its first transaction is simulated now, which also measures its
  // shape; every other transaction needs a measured budget, or the batch ends before its line.
  const { value: lifetime } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const prepared: Prepared[] = [];
  let end = lines.length;
  for (let line = start; line < lines.length; line++) {
    const chunkLine = lines[line];
    if (!chunkLine) break;
    const isFirst = prepared.length === 0;
    const budgetable = chunkLine.transactions.every(
      (transaction, index) =>
        (isFirst && index === 0) || budgets.get(version, transaction.instructions) !== undefined,
    );
    if (!budgetable) {
      end = line;
      break;
    }
    for (const [index, transaction] of chunkLine.transactions.entries()) {
      const measured = budgets.get(version, transaction.instructions);
      const instructions = transaction.instructions.map(fromPortableInstruction);
      let message;
      try {
        const result = await prepareTransaction({
          rpc,
          version,
          feePayer: wallet.address,
          instructions,
          lifetime,
          ...(measured ? { measured } : {}),
          ...(options.priorityFeeCapMicroLamports === undefined
            ? {}
            : { priorityFeeCapMicroLamports: options.priorityFeeCapMicroLamports }),
        });
        message = result.message;
        if (!measured)
          budgets.set(version, transaction.instructions, measuredBudgetOf(result.prepared));
      } catch (error) {
        throw new ChunkStepError(line, index, transaction.role, error, false, []);
      }
      prepared.push({
        line,
        index,
        role: transaction.role,
        programs: message.instructions.map((instruction) => instruction.programAddress),
        built: compileTransaction(message),
      });
    }
  }

  if (prepared.length === 0) {
    const unsent: number[] = [];
    for (let rest = start; rest < lines.length; rest++) unsent.push(rest);
    return { landed, unsent, prompts };
  }
  let signed: readonly Transaction[];
  try {
    signed = await wallet.modifyAndSignTransactions(prepared.map((item) => item.built));
  } catch (error) {
    throw new WalletSigningError(error);
  }
  prompts += 1;
  if (signed.length !== prepared.length) {
    throw new WalletSigningError(new Error("the wallet returned another number of transactions"));
  }
  // 06 section 9: every signed message is checked before anything of the chunk is sent.
  for (const [position, item] of prepared.entries()) {
    const comparison = compareSignedMessage(
      item.built.messageBytes,
      (signed[position] as Transaction).messageBytes,
    );
    await options.onSignedMessage?.(comparison);
    if (comparison.kind === "changed") throw new WalletChangedTransactionError(comparison.reason);
  }

  for (let line = start; line < end; line++) {
    const items = prepared
      .map((item, position) => ({ item, transaction: signed[position] as Transaction }))
      .filter(({ item }) => item.line === line);
    const needed = BigInt(items.length) * BLOCKS_PER_TRANSACTION + BLOCK_MARGIN;
    const height = await rpc.getBlockHeight({ commitment: "confirmed" }).send();
    if (lifetime.lastValidBlockHeight - height < needed) {
      const unsent: number[] = [];
      for (let rest = line; rest < lines.length; rest++) unsent.push(rest);
      return { landed, unsent, prompts };
    }
    const chunkLine = lines[line];
    const signatures: string[] = [];
    let transfer: string | null = null;
    for (const { item, transaction } of items) {
      await options.onStep?.(line, item.index, item.role);
      let wire: ReturnType<typeof getBase64EncodedWireTransaction>;
      let signature: string;
      try {
        const ready = chunkLine?.cosign
          ? {
              ...transaction,
              signatures: { ...transaction.signatures, ...(await chunkLine.cosign(transaction)) },
            }
          : transaction;
        assertIsFullySignedTransaction(ready);
        assertIsTransactionWithinSizeLimit(ready);
        wire = getBase64EncodedWireTransaction(ready);
        signature = getSignatureFromTransaction(ready);
        const simulation = await simulateSigned(rpc, wire);
        if (simulation.err) {
          throw new SimulationFailedError(simulation.err, simulation.logs, item.programs);
        }
        await options.onSignature?.(line, item.index, item.role, signature);
      } catch (error) {
        throw new ChunkStepError(line, item.index, item.role, error, false, [...signatures]);
      }
      signatures.push(signature);
      try {
        await rpc
          .sendTransaction(wire, { encoding: "base64", preflightCommitment: "confirmed" })
          .send();
        await waitForConfirmation(
          rpc,
          signature as Parameters<typeof waitForConfirmation>[1],
          options.confirmTimeoutMs,
          "confirmed",
        );
      } catch (error) {
        throw new ChunkStepError(line, item.index, item.role, error, true, [...signatures]);
      }
      if (item.role === "transfer") transfer = signature;
    }
    await land(transferOf(line, signatures, transfer));
  }
  const unsent: number[] = [];
  for (let rest = end; rest < lines.length; rest++) unsent.push(rest);
  return { landed, unsent, prompts };
}
