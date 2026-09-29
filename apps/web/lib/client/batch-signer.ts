// One wallet prompt for a payroll chunk (D-21, D-26, 06 section 7; step 2.3). The @solana/react 8.3.0
// transaction signer refuses more than one transaction per call (SOLANA_ERROR__SIGNER__WALLET_
// MULTISIGN_UNIMPLEMENTED), so the chunk signs through `useSignTransactions`, which passes every
// transaction to one `solana:signTransaction` call of the Wallet Standard; whether the wallet shows
// one prompt for them is the wallet's choice. Each signed transaction keeps the lifetime Sotto built
// when its message kept the blockhash, as the @solana/react signer does; the signed message check of
// 06 section 9 runs on every one of them before anything is sent (chunk-send.ts).
import {
  address,
  assertIsTransactionWithinSizeLimit,
  bytesEqual,
  getCompiledTransactionMessageDecoder,
  getTransactionCodec,
  getTransactionLifetimeConstraintFromCompiledTransactionMessage,
  type Transaction,
  type TransactionModifyingSigner,
  type TransactionWithinSizeLimit,
  type TransactionWithLifetime,
} from "@solana/kit";

type SignTransactions = (
  ...inputs: readonly { transaction: Uint8Array }[]
) => Promise<readonly { signedTransaction: Uint8Array }[]>;

type Signed = Transaction & TransactionWithinSizeLimit & TransactionWithLifetime;

export function batchSigner(
  walletAddress: string,
  signTransactions: SignTransactions,
): TransactionModifyingSigner {
  const codec = getTransactionCodec();
  return {
    address: address(walletAddress),
    async modifyAndSignTransactions(transactions, config = {}) {
      config.abortSignal?.throwIfAborted();
      if (transactions.length === 0) return [];
      const outputs = await signTransactions(
        ...transactions.map((transaction) => ({
          transaction: new Uint8Array(codec.encode(transaction)),
        })),
      );
      if (outputs.length !== transactions.length) {
        throw new Error("the wallet returned another number of signed transactions");
      }
      return Promise.all(
        outputs.map(async (output, index): Promise<Signed> => {
          const original = transactions[index] as Transaction &
            Partial<Pick<TransactionWithLifetime, "lifetimeConstraint">>;
          const decoded = codec.decode(output.signedTransaction);
          assertIsTransactionWithinSizeLimit(decoded);
          const compiled = getCompiledTransactionMessageDecoder().decode(decoded.messageBytes);
          const lifetime = original.lifetimeConstraint;
          if (lifetime) {
            const token = "blockhash" in lifetime ? lifetime.blockhash : lifetime.nonce;
            if (
              bytesEqual(decoded.messageBytes, original.messageBytes) ||
              compiled.lifetimeToken === token
            ) {
              return Object.freeze({ ...decoded, lifetimeConstraint: lifetime }) as Signed;
            }
          }
          return Object.freeze({
            ...decoded,
            lifetimeConstraint:
              await getTransactionLifetimeConstraintFromCompiledTransactionMessage(compiled),
          }) as Signed;
        }),
      );
    },
  };
}
