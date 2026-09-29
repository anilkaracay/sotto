// The payroll chunk sender (step 2.3, 06 section 7) against an RPC stand in: one wallet call for the
// chunk, a simulation before signing only for the batch's first transaction and one before sending
// for every transaction, a first line whose later transactions were never measured sent one
// transaction at a time, a line never started when the blockhash has too few blocks left, and a
// failed simulation right before sending that stops the chunk with nothing more sent.
import {
  AccountRole,
  address,
  generateKeyPairSigner,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import {
  BudgetMemory,
  ChunkStepError,
  sendTransferChunk,
  type ChunkLine,
} from "../src/confidential/public.ts";
import { keypairWallet } from "../src/testing/index.ts";
import type { SolanaRpc } from "../src/tx/index.ts";

const PROGRAM = address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const LAST_VALID = 1_000n;

type Calls = { simulations: boolean[]; sent: number; heights: number };

function standIn(options: { height?: bigint; failSigned?: (call: number) => boolean } = {}) {
  const calls: Calls = { simulations: [], sent: 0, heights: 0 };
  let signedSimulations = 0;
  const rpc = {
    getRecentPrioritizationFees: () => ({ send: async () => [] }),
    getLatestBlockhash: () => ({
      send: async () => ({
        context: { slot: 1n },
        value: {
          blockhash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
          lastValidBlockHeight: LAST_VALID,
        },
      }),
    }),
    simulateTransaction: (_wire: string, config: { sigVerify: boolean }) => ({
      send: async () => {
        calls.simulations.push(config.sigVerify);
        const failing = config.sigVerify && options.failSigned?.(signedSimulations++) === true;
        return {
          context: { slot: 1n },
          value: {
            err: failing ? { InstructionError: [0, { Custom: 1 }] } : null,
            logs: [],
            unitsConsumed: 5_000n,
            loadedAccountsDataSize: 10_000,
          },
        };
      },
    }),
    getBlockHeight: () => ({
      send: async () => {
        calls.heights += 1;
        return options.height ?? 500n;
      },
    }),
    sendTransaction: () => ({
      send: async () => {
        calls.sent += 1;
        return "sent";
      },
    }),
    getSignatureStatuses: () => ({
      send: async () => ({
        context: { slot: 2n },
        value: [{ slot: 2n, confirmations: 1n, err: null, confirmationStatus: "confirmed" }],
      }),
    }),
  };
  return { rpc: rpc as unknown as SolanaRpc, calls };
}

let lineNo = 0;

/** A line of distinct transactions; the transaction at each place has its own shape (data length). */
function line(transactions: number, account: Address): ChunkLine {
  lineNo += 1;
  return {
    transactions: Array.from({ length: transactions }, (_, index) => ({
      role: index === transactions - 1 ? ("transfer" as const) : ("proof" as const),
      instructions: [
        {
          programAddress: PROGRAM,
          accounts: [{ address: account, role: AccountRole.WRITABLE }],
          data: new Uint8Array([lineNo, ...new Array<number>(index + 2).fill(7)]),
        },
      ],
    })),
  };
}

describe("payroll chunk sender (06 section 7)", () => {
  let signer: KeyPairSigner;
  let account: Address;

  beforeAll(async () => {
    signer = await generateKeyPairSigner();
    account = (await generateKeyPairSigner()).address;
  });

  function counted() {
    const calls: number[] = [];
    const inner = keypairWallet(signer);
    return {
      calls,
      wallet: {
        address: inner.address,
        modifyAndSignTransactions: async (
          transactions: Parameters<typeof inner.modifyAndSignTransactions>[0],
        ) => {
          calls.push(transactions.length);
          return inner.modifyAndSignTransactions(transactions);
        },
      },
    };
  }

  it("AC-08.4 signs a chunk with one wallet call, simulates its first transaction before signing and every transaction before sending", async () => {
    const { rpc, calls } = standIn();
    const { wallet, calls: prompts } = counted();
    const signatures: string[] = [];
    const result = await sendTransferChunk({
      rpc,
      wallet,
      version: 1,
      lines: [line(1, account), line(1, account), line(1, account)],
      budgets: new BudgetMemory(),
      onSignature: (_line, _index, _role, signature) => void signatures.push(signature),
    });
    expect(prompts).toEqual([3]);
    expect(result.prompts).toBe(1);
    expect(result.landed.map((landed) => landed.line)).toEqual([0, 1, 2]);
    // One simulation to budget the first transaction, then one before each send.
    expect(calls.simulations).toEqual([false, true, true, true]);
    expect(calls.sent).toBe(3);
    expect(signatures).toHaveLength(3);
    expect(new Set(signatures).size).toBe(3);
  });

  it("AC-08.4 sends a first line whose later transactions were never measured one transaction at a time, then the rest in one call", async () => {
    const { rpc } = standIn();
    const { wallet, calls: prompts } = counted();
    const budgets = new BudgetMemory();
    const result = await sendTransferChunk({
      rpc,
      wallet,
      version: 0,
      lines: [line(2, account), line(2, account), line(2, account)],
      budgets,
    });
    expect(prompts).toEqual([1, 1, 4]);
    expect(result.prompts).toBe(3);
    expect(result.landed).toHaveLength(3);
    expect(budgets.size).toBe(2);
    // A later chunk of the run needs no measuring: one call.
    const again = counted();
    await sendTransferChunk({
      rpc,
      wallet: again.wallet,
      version: 0,
      lines: [line(2, account), line(2, account)],
      budgets,
    });
    expect(again.calls).toEqual([4]);
  });

  it("AC-08.4 starts no line while the chunk's blockhash has too few blocks left, and sends nothing", async () => {
    const { rpc, calls } = standIn({ height: LAST_VALID - 5n });
    const { wallet } = counted();
    const result = await sendTransferChunk({
      rpc,
      wallet,
      version: 1,
      lines: [line(1, account), line(1, account)],
      budgets: new BudgetMemory(),
    });
    expect(result.landed).toEqual([]);
    expect(result.unsent).toEqual([0, 1]);
    expect(calls.sent).toBe(0);
  });

  it("AC-08.5 stops at a line whose simulation right before sending fails, with nothing of it sent", async () => {
    const { rpc, calls } = standIn({ failSigned: (call) => call === 1 });
    const { wallet } = counted();
    const recorded: number[] = [];
    let failure: unknown;
    try {
      await sendTransferChunk({
        rpc,
        wallet,
        version: 1,
        lines: [line(1, account), line(1, account), line(1, account)],
        budgets: new BudgetMemory(),
        onSignature: (lineIndex) => void recorded.push(lineIndex),
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ChunkStepError);
    expect((failure as ChunkStepError).line).toBe(1);
    expect((failure as ChunkStepError).sent).toBe(false);
    expect(calls.sent).toBe(1);
    expect(recorded).toEqual([0]);
  });
});
