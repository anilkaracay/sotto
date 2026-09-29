// Paying the lines of a payroll run in chunks (06 section 7, D-21, AC-08.4; step 2.3). No keys: the
// caller builds each chunk's plans where the keys live (the crypto worker, or keys in tests) with
// confidentialTransferChunk, and this module drives the run:
// 1. the lines in order, at most `chunkLines` per chunk (10 for version 1, whose line is one
//    transaction; 4 for version 0, whose line is 5 transactions, facts A17, so a chunk holds at most
//    20 transactions and lands well within its blockhash's lifetime);
// 2. for each chunk the sender's and the recipients' accounts are read fresh from chain, the plans are
//    built from that state and the chunk is signed and sent (chunk-send.ts); lines the chunk could not
//    start before its blockhash ran low are prepared again in the next chunk;
// 3. the first line that fails stops the run: nothing after it is sent, and the proof accounts it
//    created are closed with their rent to the fee payer (06 section 5). The caller records the line
//    and the run (partially settled), and a resume pays the remaining lines from chain state.
// Every signature reaches `onSignature` before its transaction is sent (the executions record, I-7).
import {
  address,
  fetchEncodedAccount,
  fetchEncodedAccounts,
  type Address,
  type TransactionModifyingSigner,
} from "@solana/kit";
import type { TransactionVersionChoice } from "../tx/budget.ts";
import type { PortableInstruction } from "../tx/portable.ts";
import type { SolanaRpc } from "../tx/rpc.ts";
import type { SignedMessageComparison } from "../tx/signed-message.ts";
import {
  BudgetMemory,
  ChunkStepError,
  sendTransferChunk,
  type ChunkLine,
  type LandedLine,
} from "./chunk-send.ts";
import { closeProofAccounts, type TransferTransactionRole } from "./transfer-send.ts";

/** At most this many lines are signed together (D-21, 06 section 7). */
export const MAX_CHUNK_LINES = 10;
/** At most this many transactions are signed together, so a chunk lands within about a minute. */
export const MAX_CHUNK_TRANSACTIONS = 20;
/** Transactions of one line per version (facts A17). */
export const TRANSACTIONS_PER_LINE: Record<TransactionVersionChoice, number> = { 0: 5, 1: 1 };
/** Chunks in a row that end before their first line (the blockhash ran out) before the run stops. */
export const MAX_EMPTY_CHUNKS = 3;

export function chunkLinesFor(version: TransactionVersionChoice): number {
  return Math.max(
    1,
    Math.min(MAX_CHUNK_LINES, Math.floor(MAX_CHUNK_TRANSACTIONS / TRANSACTIONS_PER_LINE[version])),
  );
}

export type PayrollPayment = {
  /** The line's id (the payment row). */
  id: string;
  destinationToken: Address;
  amount: bigint;
};

export type BuiltChunk = {
  /** The chunk's lines in the order requested, with the plan's own signers. */
  lines: ChunkLine[];
  /** Each line's closing instructions (proof context and record accounts). */
  cleanups: PortableInstruction[][];
  /** The available balance the sender should have once every line of the chunk landed. */
  availableAfter: bigint;
  /** Drops the plans' keypairs. */
  release: () => Promise<void>;
};

export type PaidLine = { payment: PayrollPayment; signatures: string[]; transferSignature: string };

export type PayrollPayOutcome = {
  landed: PaidLine[];
  prompts: number;
  /** The line that stopped the run, if one did; nothing after it was sent. */
  stopped: {
    payment: PayrollPayment;
    error: unknown;
    /** The step: the transaction's role and place in its line (for version 0), or null. */
    step: { index: number; role: TransferTransactionRole } | null;
    /** Whether a transaction of the line reached the network. */
    sent: boolean;
    /** The line's signatures handed out before the stop. */
    signatures: string[];
    /** Every proof account the line created is closed (or none was created). */
    cleaned: boolean;
    cleanupSignatures: string[];
  } | null;
};

async function readData(rpc: SolanaRpc, at: Address): Promise<Uint8Array> {
  const account = await fetchEncodedAccount(rpc, at, { commitment: "confirmed" });
  if (!account.exists) throw new Error(`the account ${at} does not exist`);
  return new Uint8Array(account.data);
}

export async function payPayrollLines(options: {
  rpc: SolanaRpc;
  wallet: TransactionModifyingSigner;
  version: TransactionVersionChoice;
  sourceToken: Address;
  mint: Address;
  payments: readonly PayrollPayment[];
  buildChunk: (input: {
    source: Uint8Array;
    mint: Uint8Array;
    lines: { destinationToken: Address; destination: Uint8Array; amount: bigint }[];
  }) => Promise<BuiltChunk>;
  budgets?: BudgetMemory;
  signing?: "batch" | "each";
  chunkLines?: number;
  /** Each signature before its transaction is sent; if it throws, nothing more is sent. */
  onSignature: (
    payment: PayrollPayment,
    role: TransferTransactionRole,
    signature: string,
  ) => Promise<void>;
  onSignedMessage?: (comparison: SignedMessageComparison) => void | Promise<void>;
  onLineLanded?: (paid: PaidLine) => void | Promise<void>;
  /** After a chunk's lines confirmed: the caller waits for finality and writes disclosures. */
  onChunkLanded?: (chunk: { lines: PaidLine[]; availableAfter: bigint | null }) => Promise<void>;
  onProgress?: (event: { kind: "preparing" | "signing" | "sending"; line: PayrollPayment }) => void;
  confirmTimeoutMs?: number;
}): Promise<PayrollPayOutcome> {
  const { rpc } = options;
  const budgets = options.budgets ?? new BudgetMemory();
  const size = Math.max(
    1,
    Math.min(MAX_CHUNK_LINES, options.chunkLines ?? chunkLinesFor(options.version)),
  );
  const landed: PaidLine[] = [];
  let prompts = 0;
  let remaining = [...options.payments];
  let empty = 0;
  const mintData = remaining.length > 0 ? await readData(rpc, options.mint) : null;

  while (remaining.length > 0 && mintData) {
    const chunk = remaining.slice(0, size);
    const first = chunk[0] as PayrollPayment;
    options.onProgress?.({ kind: "preparing", line: first });
    const [source, destinations] = await Promise.all([
      readData(rpc, options.sourceToken),
      fetchEncodedAccounts(
        rpc,
        chunk.map((payment) => payment.destinationToken),
        { commitment: "confirmed" },
      ),
    ]);
    const missing = destinations.findIndex((account) => !account.exists);
    if (missing >= 0) {
      const payment = chunk[missing] as PayrollPayment;
      return {
        landed,
        prompts,
        stopped: {
          payment,
          error: new Error("the recipient's wUSDC account does not exist onchain"),
          step: null,
          sent: false,
          signatures: [],
          cleaned: true,
          cleanupSignatures: [],
        },
      };
    }
    let built: BuiltChunk;
    try {
      built = await options.buildChunk({
        source,
        mint: mintData,
        lines: chunk.map((payment, index) => {
          const account = destinations[index];
          if (!account?.exists) throw new Error("unreachable");
          return {
            destinationToken: payment.destinationToken,
            destination: new Uint8Array(account.data),
            amount: payment.amount,
          };
        }),
      });
    } catch (error) {
      return {
        landed,
        prompts,
        stopped: {
          payment: first,
          error,
          step: null,
          sent: false,
          signatures: [],
          cleaned: true,
          cleanupSignatures: [],
        },
      };
    }
    const chunkLanded: PaidLine[] = [];
    try {
      options.onProgress?.({ kind: "signing", line: first });
      const result = await sendTransferChunk({
        rpc,
        wallet: options.wallet,
        version: options.version,
        lines: built.lines,
        budgets,
        ...(options.signing ? { signing: options.signing } : {}),
        ...(options.onSignedMessage ? { onSignedMessage: options.onSignedMessage } : {}),
        ...(options.confirmTimeoutMs === undefined
          ? {}
          : { confirmTimeoutMs: options.confirmTimeoutMs }),
        onStep: (line) =>
          options.onProgress?.({ kind: "sending", line: chunk[line] as PayrollPayment }),
        onSignature: (line, _index, role, signature) =>
          options.onSignature(chunk[line] as PayrollPayment, role, signature),
        onLineLanded: async (line: LandedLine) => {
          const paid: PaidLine = {
            payment: chunk[line.line] as PayrollPayment,
            signatures: line.signatures,
            transferSignature: line.transferSignature,
          };
          chunkLanded.push(paid);
          landed.push(paid);
          await options.onLineLanded?.(paid);
        },
      });
      prompts += result.prompts;
    } catch (error) {
      await built.release().catch(() => undefined);
      if (chunkLanded.length > 0) {
        await options.onChunkLanded?.({ lines: chunkLanded, availableAfter: null });
      }
      const line = error instanceof ChunkStepError ? error.line : chunkLanded.length;
      const payment = chunk[line] as PayrollPayment;
      const sent = error instanceof ChunkStepError ? error.sent || error.index > 0 : false;
      // 06 section 5: the proof accounts the stopped line created are closed, rent to the fee payer.
      let cleaned = true;
      let cleanupSignatures: string[] = [];
      const cleanup = built.cleanups[line] ?? [];
      if (sent && cleanup.length > 0) {
        try {
          const closed = await closeProofAccounts({
            rpc,
            wallet: options.wallet,
            version: options.version,
            cleanup,
            ...(built.lines[line]?.cosign ? { cosign: built.lines[line]?.cosign } : {}),
            ...(options.onSignedMessage ? { onSignedMessage: options.onSignedMessage } : {}),
          });
          cleanupSignatures = closed.signatures;
          const left = await fetchEncodedAccounts(
            rpc,
            cleanup.map((instruction) =>
              address(instruction.accounts[0]?.address ?? options.sourceToken),
            ),
            { commitment: "confirmed" },
          );
          cleaned = left.every((account) => !account.exists);
        } catch {
          cleaned = false;
        }
      }
      return {
        landed,
        prompts,
        stopped: {
          payment,
          error,
          step: error instanceof ChunkStepError ? { index: error.index, role: error.role } : null,
          sent,
          signatures: error instanceof ChunkStepError ? error.signatures : [],
          cleaned,
          cleanupSignatures,
        },
      };
    }
    await built.release().catch(() => undefined);
    const done = new Set(chunkLanded.map((paid) => paid.payment.id));
    remaining = remaining.filter((payment) => !done.has(payment.id));
    if (chunkLanded.length > 0) {
      empty = 0;
      await options.onChunkLanded?.({
        lines: chunkLanded,
        availableAfter: chunkLanded.length === chunk.length ? built.availableAfter : null,
      });
    } else if (++empty >= MAX_EMPTY_CHUNKS) {
      return {
        landed,
        prompts,
        stopped: {
          payment: first,
          error: new Error("the signed transactions expired before they could be sent"),
          step: null,
          sent: false,
          signatures: [],
          cleaned: true,
          cleanupSignatures: [],
        },
      };
    }
  }
  return { landed, prompts, stopped: null };
}
