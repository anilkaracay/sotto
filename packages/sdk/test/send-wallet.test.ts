// The wallet signed path (06 section 9, step 1.7): the three cases of the signed message check
// decide before anything is sent, and the caller hears each comparison for the log with the wallet
// name. Also the portable instructions the crypto worker posts to the page.
import { getTransferSolInstruction } from "@solana-program/system";
import {
  AccountRole,
  generateKeyPairSigner,
  lamports,
  setTransactionMessageComputeUnitPrice,
  type Blockhash,
  type KeyPairSigner,
  type TransactionMessage,
} from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { keypairWallet } from "../src/testing/index.ts";
import {
  sendWithWallet,
  toPortableInstruction,
  WALLET_CHANGED_TRANSACTION,
  WalletChangedTransactionError,
  WalletSigningError,
  type SignedMessageComparison,
  type SolanaRpc,
} from "../src/tx/index.ts";

const BLOCKHASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" as Blockhash;

/** Preparation, sending and confirmation against recorded calls; nothing reaches a network. */
function fakeRpc() {
  const sent: string[] = [];
  const rpc = {
    getRecentPrioritizationFees: () => ({
      send: async () => [{ prioritizationFee: 100n, slot: 1n }],
    }),
    getLatestBlockhash: () => ({
      send: async () => ({ value: { blockhash: BLOCKHASH, lastValidBlockHeight: 100n } }),
    }),
    simulateTransaction: () => ({
      send: async () => ({
        value: { err: null, logs: [], unitsConsumed: 1000n, loadedAccountsDataSize: 4000 },
      }),
    }),
    sendTransaction: (wire: string) => {
      sent.push(wire);
      return { send: async () => "sig" };
    },
    getSignatureStatuses: () => ({
      send: async () => ({ value: [{ confirmationStatus: "confirmed", err: null }] }),
    }),
  };
  return { rpc: rpc as unknown as SolanaRpc, sent };
}

describe("wallet signed transactions (06 section 9)", () => {
  let payer: KeyPairSigner;
  let recipient: KeyPairSigner;

  beforeAll(async () => {
    payer = await generateKeyPairSigner();
    recipient = await generateKeyPairSigner();
  });

  const transfer = () =>
    getTransferSolInstruction({
      source: payer,
      destination: recipient.address,
      amount: lamports(1_000n),
    });

  it("sends what the wallet signed unchanged, for v0 and v1", async () => {
    for (const version of [0, 1] as const) {
      const { rpc, sent } = fakeRpc();
      const heard: SignedMessageComparison[] = [];
      const result = await sendWithWallet({
        rpc,
        wallet: keypairWallet(payer),
        instructions: [transfer()],
        version,
        onSignedMessage: (comparison) => void heard.push(comparison),
      });
      expect(result.comparison).toEqual({ kind: "identical" });
      expect(heard).toEqual([{ kind: "identical" }]);
      expect(sent).toHaveLength(1);
      expect(result.version).toBe(version);
    }
  });

  it("sends when the wallet changed only the compute budget, and reports the change", async () => {
    const { rpc, sent } = fakeRpc();
    const heard: SignedMessageComparison[] = [];
    const wallet = keypairWallet(payer, (message) =>
      setTransactionMessageComputeUnitPrice(
        500_000n,
        message as Extract<TransactionMessage, { version: 0 }>,
      ),
    );
    const result = await sendWithWallet({
      rpc,
      wallet,
      instructions: [transfer()],
      version: 0,
      onSignedMessage: (comparison) => void heard.push(comparison),
    });
    expect(result.comparison).toEqual({
      kind: "compute_budget_only",
      changes: [{ field: "computeUnitPrice", built: "100", signed: "500000" }],
    });
    expect(heard).toEqual([result.comparison]);
    expect(sent).toHaveLength(1);
  });

  it("refuses to send when the wallet changed an instruction", async () => {
    const { rpc, sent } = fakeRpc();
    const heard: SignedMessageComparison[] = [];
    const wallet = keypairWallet(payer, (message) => ({
      ...message,
      instructions: message.instructions.map((instruction, index) =>
        index === 0 && instruction.data
          ? { ...instruction, data: new Uint8Array([...instruction.data].fill(9, 4)) }
          : instruction,
      ),
    }));
    const error = await sendWithWallet({
      rpc,
      wallet,
      instructions: [transfer()],
      version: 0,
      onSignedMessage: (comparison) => void heard.push(comparison),
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WalletChangedTransactionError);
    expect((error as Error).message).toBe(WALLET_CHANGED_TRANSACTION);
    expect((error as WalletChangedTransactionError).reason).toBe("instruction 1: the data");
    expect(heard).toEqual([{ kind: "changed", reason: "instruction 1: the data" }]);
    expect(sent).toHaveLength(0);
  });

  it("hands back the wallet's own error when it refuses to sign, after the simulation passed", async () => {
    const { rpc, sent } = fakeRpc();
    const refusal = Object.assign(new Error("Transaction blocked"), { name: "WalletSignError" });
    const wallet = {
      address: payer.address,
      modifyAndSignTransactions: async () => {
        throw refusal;
      },
    };
    const error = await sendWithWallet({
      rpc,
      wallet,
      instructions: [transfer()],
      version: 0,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WalletSigningError);
    expect((error as WalletSigningError).cause).toBe(refusal);
    expect(sent).toHaveLength(0);
  });
});

describe("portable instructions (04 section 5)", () => {
  it("keeps the program, the data and each account's role, without signer objects", async () => {
    const payer = await generateKeyPairSigner();
    const instruction = getTransferSolInstruction({
      source: payer,
      destination: (await generateKeyPairSigner()).address,
      amount: lamports(5n),
    });
    const portable = toPortableInstruction(instruction);
    expect(portable.programAddress).toBe(instruction.programAddress);
    expect(portable.data).toEqual(new Uint8Array(instruction.data));
    expect(portable.accounts).toEqual([
      { address: payer.address, role: AccountRole.WRITABLE_SIGNER },
      { address: instruction.accounts[1].address, role: AccountRole.WRITABLE },
    ]);
    // It survives postMessage's structured clone, which a signer's functions would not.
    expect(() => structuredClone(instruction)).toThrow();
    expect(structuredClone(portable)).toEqual(portable);
  });
});
