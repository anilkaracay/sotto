// Step 4.9: a page never waits on the network without end, and a transfer that landed is a payment
// that went through. The wallet signed path with a network that gives no answer to a send or to a
// question about a signature; the chain asked with its history before a sent transfer is called a
// failure; and the cases that stay failures: the chain refused it, the wallet did not sign, or the
// chain does not know the signature. Nothing reaches a network.
import { getTransferSolInstruction } from "@solana-program/system";
import { generateKeyPairSigner, lamports, type Blockhash, type KeyPairSigner } from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import {
  isUndecidedTransfer,
  sendTransferTransactions,
  TransferStepError,
  type SendableTransaction,
} from "../src/confidential/transfer-send.ts";
import { keypairWallet } from "../src/testing/index.ts";
import {
  RpcTimeoutError,
  sendWithWallet,
  toPortableInstruction,
  TransactionFailedError,
  transactionLanded,
  waitForConfirmation,
  WalletSigningError,
  type SolanaRpc,
} from "../src/tx/index.ts";

const BLOCKHASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" as Blockhash;
type Status = { confirmationStatus: "processed" | "confirmed" | "finalized"; err: unknown } | null;

/**
 * A network of recorded calls. `send` and `status` decide what a send and a question about a
 * signature get: an answer, an error, or no answer in time (an RpcTimeoutError, as the transport
 * raises it). `history` is what the chain says when asked with its history.
 */
function fakeRpc(behaviour: {
  send?: (count: number) => void;
  status?: (count: number) => Status;
  history?: (count: number) => Status;
}) {
  const calls = { send: 0, status: 0, history: 0 };
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
    sendTransaction: () => ({
      send: async () => {
        calls.send++;
        behaviour.send?.(calls.send);
        return "sig";
      },
    }),
    getSignatureStatuses: (_: unknown, config?: { searchTransactionHistory?: boolean }) => ({
      send: async () => {
        if (config?.searchTransactionHistory) {
          calls.history++;
          return { value: [behaviour.history ? behaviour.history(calls.history) : null] };
        }
        calls.status++;
        return {
          value: [
            behaviour.status
              ? behaviour.status(calls.status)
              : { confirmationStatus: "finalized", err: null },
          ],
        };
      },
    }),
  };
  return { rpc: rpc as unknown as SolanaRpc, calls };
}

const noAnswer = (method: string) => new RpcTimeoutError(method, 20_000);
const FINAL: Status = { confirmationStatus: "finalized", err: null };

describe("a network that gives no answer (step 4.9)", () => {
  let payer: KeyPairSigner;
  let recipient: KeyPairSigner;
  let plan: SendableTransaction[];

  beforeAll(async () => {
    payer = await generateKeyPairSigner();
    recipient = await generateKeyPairSigner();
    const instruction = toPortableInstruction(
      getTransferSolInstruction({
        source: payer,
        destination: recipient.address,
        amount: lamports(1_000n),
      }),
    );
    // A proof transaction, then the transfer itself, as a transfer plan for a version 0 wallet has.
    plan = [
      { role: "proof", instructions: [instruction] },
      { role: "transfer", instructions: [instruction] },
    ];
  });

  const transfer = () =>
    getTransferSolInstruction({
      source: payer,
      destination: recipient.address,
      amount: lamports(1_000n),
    });

  it("goes on to look the signature up when the send got no answer, and never sends twice", async () => {
    const { rpc, calls } = fakeRpc({
      send: () => {
        throw noAnswer("sendTransaction");
      },
    });
    const result = await sendWithWallet({
      rpc,
      wallet: keypairWallet(payer),
      instructions: [transfer()],
      version: 0,
      finalize: true,
    });
    expect(result.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
    expect(calls.send).toBe(1);
    expect(calls.status).toBeGreaterThan(0);
  });

  it("keeps asking for a confirmation over questions that got no answer, until its deadline", async () => {
    const { rpc, calls } = fakeRpc({
      status: (count) => {
        if (count <= 2) throw noAnswer("getSignatureStatuses");
        return FINAL;
      },
    });
    const sig = (
      await sendWithWallet({
        rpc,
        wallet: keypairWallet(payer),
        instructions: [transfer()],
        version: 0,
      })
    ).signature;
    expect(calls.status).toBe(3);
    // With no answer ever, the wait ends at its deadline with the usual words, not with a hang.
    const silent = fakeRpc({
      status: () => {
        throw noAnswer("getSignatureStatuses");
      },
    });
    await expect(waitForConfirmation(silent.rpc, sig, 30, "finalized")).rejects.toThrow(
      /was not finalized within 0.03 seconds/,
    );
  });

  it("asks the chain with its history whether a transaction landed", async () => {
    const sig = (
      await sendWithWallet({
        rpc: fakeRpc({}).rpc,
        wallet: keypairWallet(payer),
        instructions: [transfer()],
        version: 0,
      })
    ).signature;
    const none = async () => {};
    expect(await transactionLanded(fakeRpc({ history: () => FINAL }).rpc, sig, 50, none)).toBe(
      "landed",
    );
    expect(
      await transactionLanded(
        fakeRpc({ history: () => ({ confirmationStatus: "confirmed", err: null }) }).rpc,
        sig,
        50,
        none,
      ),
    ).toBe("landed");
    expect(
      await transactionLanded(
        fakeRpc({ history: () => ({ confirmationStatus: "finalized", err: { custom: 1 } }) }).rpc,
        sig,
        50,
        none,
      ),
    ).toBe("failed");
    // Not known yet, then known: asked again within the time.
    const later = fakeRpc({ history: (count) => (count < 3 ? null : FINAL) });
    expect(await transactionLanded(later.rpc, sig, 5_000, none)).toBe("landed");
    expect(later.calls.history).toBe(3);
    // Never known, or a chain that cannot be asked: unknown, after the time.
    expect(await transactionLanded(fakeRpc({}).rpc, sig, 20, none)).toBe("unknown");
    const down = fakeRpc({
      history: () => {
        throw noAnswer("getSignatureStatuses");
      },
    });
    expect(await transactionLanded(down.rpc, sig, 20, none)).toBe("unknown");
  });

  it("counts a transfer that landed as sent, when the wait for it ended without an answer", async () => {
    // The proof transaction confirms; the transfer's confirmation is never answered in time, and
    // the chain, asked with its history, has it finalized.
    let transferAsked = false;
    const { rpc, calls } = fakeRpc({
      status: () => {
        if (calls.send < 2) return { confirmationStatus: "confirmed", err: null };
        transferAsked = true;
        throw new Error("the network did not answer");
      },
      history: () => FINAL,
    });
    const recorded: string[] = [];
    const sent = await sendTransferTransactions({
      rpc,
      wallet: keypairWallet(payer),
      version: 0,
      transactions: plan,
      onSignature: (_, role, signature) => void recorded.push(`${role}:${signature}`),
      landedTimeoutMs: 50,
    });
    expect(transferAsked).toBe(true);
    expect(calls.send).toBe(2);
    expect(calls.history).toBe(1);
    expect(sent.signatures).toHaveLength(2);
    expect(sent.transferSignature).toBe(sent.signatures[1]);
    expect(recorded).toEqual([`proof:${sent.signatures[0]}`, `transfer:${sent.signatures[1]}`]);
  });

  it("calls a transfer undecided only when it was sent and neither the chain nor the wallet refused it", () => {
    const sig = "5".repeat(88);
    const late = new Error("was not finalized within 90 seconds");
    // Sent, and its wait ended without an answer.
    expect(isUndecidedTransfer(new TransferStepError(1, "transfer", late, [sig, sig]))).toBe(true);
    expect(
      isUndecidedTransfer(
        new TransferStepError(0, "transfer", new RpcTimeoutError("getSignatureStatuses", 20_000), [
          sig,
        ]),
      ),
    ).toBe(true);
    // Not handed to the network: the wallet did not sign, or the record of its signature failed.
    expect(isUndecidedTransfer(new TransferStepError(1, "transfer", late, [sig]))).toBe(false);
    expect(
      isUndecidedTransfer(
        new TransferStepError(1, "transfer", new WalletSigningError(new Error("no")), [sig]),
      ),
    ).toBe(false);
    // Refused by the chain.
    expect(
      isUndecidedTransfer(
        new TransferStepError(
          1,
          "transfer",
          new TransactionFailedError(sig as never, { custom: 1 }, "custom program error"),
          [sig, sig],
        ),
      ),
    ).toBe(false);
    // Another step than the transfer itself.
    expect(isUndecidedTransfer(new TransferStepError(0, "proof", late, [sig]))).toBe(false);
  });

  it("does not count a signature whose record failed: nothing was sent, so nothing is looked up", async () => {
    const { rpc, calls } = fakeRpc({ history: () => FINAL });
    const failure = await sendTransferTransactions({
      rpc,
      wallet: keypairWallet(payer),
      version: 0,
      transactions: plan,
      onSignature: (_, role) => {
        if (role === "transfer") throw new Error("the record could not be saved");
      },
      landedTimeoutMs: 20,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ index: 1, role: "transfer" });
    expect((failure as TransferStepError).signatures).toHaveLength(1);
    expect(calls.send).toBe(1);
    expect(calls.history).toBe(0);
  });

  it("still fails the step when the chain does not know the transfer", async () => {
    const { rpc, calls } = fakeRpc({
      status: () => {
        if (calls.send < 2) return { confirmationStatus: "confirmed", err: null };
        throw new Error("the network did not answer");
      },
      history: () => null,
    });
    const failure = await sendTransferTransactions({
      rpc,
      wallet: keypairWallet(payer),
      version: 0,
      transactions: plan,
      landedTimeoutMs: 20,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(TransferStepError);
    expect(failure).toMatchObject({ index: 1, role: "transfer" });
    expect((failure as TransferStepError).signatures).toHaveLength(2);
    expect(calls.history).toBeGreaterThan(0);
  });

  it("does not ask again when the chain refused the transfer, the wallet did not sign, or a proof step failed", async () => {
    // The chain refused the transfer: a failure at once, with the chain's error.
    const refused = fakeRpc({
      status: () =>
        refused.calls.send < 2
          ? { confirmationStatus: "confirmed", err: null }
          : { confirmationStatus: "confirmed", err: { InstructionError: [0, { Custom: 1 }] } },
      history: () => FINAL,
    });
    const first = await sendTransferTransactions({
      rpc: refused.rpc,
      wallet: keypairWallet(payer),
      version: 0,
      transactions: plan,
      landedTimeoutMs: 20,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect((first as TransferStepError).cause).toBeInstanceOf(TransactionFailedError);
    expect(refused.calls.history).toBe(0);

    // The wallet did not sign the transfer: nothing was sent, so there is nothing to look up.
    const quiet = fakeRpc({ history: () => FINAL });
    let asked = 0;
    const wallet = keypairWallet(payer);
    const refusing: typeof wallet = {
      address: wallet.address,
      modifyAndSignTransactions: async (transactions) => {
        asked++;
        if (asked === 2) throw new Error("User rejected the request.");
        return wallet.modifyAndSignTransactions(transactions);
      },
    };
    const second = await sendTransferTransactions({
      rpc: quiet.rpc,
      wallet: refusing,
      version: 0,
      transactions: plan,
      landedTimeoutMs: 20,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect((second as TransferStepError).cause).toBeInstanceOf(WalletSigningError);
    expect((second as TransferStepError).signatures).toHaveLength(1);
    expect(quiet.calls.history).toBe(0);

    // A proof step whose wait fails is a failed step: only the transfer itself is looked up.
    const proof = fakeRpc({
      status: () => {
        throw new Error("the network did not answer");
      },
      history: () => FINAL,
    });
    const third = await sendTransferTransactions({
      rpc: proof.rpc,
      wallet: keypairWallet(payer),
      version: 0,
      transactions: plan,
      landedTimeoutMs: 20,
    }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(third).toMatchObject({ index: 0, role: "proof" });
    expect(proof.calls.history).toBe(0);
  });
});
