// The batch signer of a payroll chunk (D-21, D-26; step 2.3): every transaction of the chunk goes to
// one Wallet Standard signTransaction call, the signed transactions come back in order with the
// lifetime Sotto built, and a wallet that answers with another number of transactions is refused.
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  generateKeyPairSigner,
  getTransactionCodec,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  type Blockhash,
  type KeyPairSigner,
} from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { batchSigner } from "../lib/client/batch-signer.ts";

const LIFETIME = {
  blockhash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" as Blockhash,
  lastValidBlockHeight: 1234n,
};

let signer: KeyPairSigner;

beforeAll(async () => {
  signer = await generateKeyPairSigner();
});

function built(memo: number) {
  return compileTransaction(
    pipe(
      createTransactionMessage({ version: 1 }),
      (m) => setTransactionMessageFeePayer(signer.address, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(LIFETIME, m),
      (m) =>
        appendTransactionMessageInstructions(
          [
            {
              programAddress: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" as never,
              data: new Uint8Array([memo]),
            },
          ],
          m,
        ),
    ),
  );
}

describe("batch signer (D-21)", () => {
  it("AC-08.4 signs every transaction of a chunk in one wallet call, in order, keeping Sotto's lifetime", async () => {
    const codec = getTransactionCodec();
    const calls: number[] = [];
    const wallet = batchSigner(signer.address, async (...inputs) => {
      calls.push(inputs.length);
      return Promise.all(
        inputs.map(async ({ transaction }) => ({
          signedTransaction: new Uint8Array(
            codec.encode(await signTransaction([signer.keyPair], codec.decode(transaction))),
          ),
        })),
      );
    });
    const transactions = [built(1), built(2), built(3)];
    const signed = await wallet.modifyAndSignTransactions(transactions);
    expect(calls).toEqual([3]);
    expect(signed).toHaveLength(3);
    signed.forEach((transaction, index) => {
      expect([...transaction.messageBytes]).toEqual([...(transactions[index]?.messageBytes ?? [])]);
      expect(transaction.signatures[signer.address]).toBeTruthy();
      expect(transaction.lifetimeConstraint).toEqual(LIFETIME);
    });
    expect(await wallet.modifyAndSignTransactions([])).toEqual([]);
    expect(calls).toEqual([3]);
  });

  it("AC-08.4 refuses a wallet answer with another number of transactions", async () => {
    const wallet = batchSigner(signer.address, async () => []);
    await expect(wallet.modifyAndSignTransactions([built(1), built(2)])).rejects.toThrow(
      "the wallet returned another number of signed transactions",
    );
  });
});
