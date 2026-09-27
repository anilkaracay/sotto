// Test helpers (tests only, never imported by app code):
// - a wallet stand in backed by a keypair, which signs transactions through the same modifying signer
//   interface as a browser wallet (@solana/react), optionally changing the message first, like a
//   wallet that adds its own compute budget or rewrites an instruction (06 section 9);
// - a valid Ed25519 signature made with a random nonce instead of the deterministic one (RFC 8032
//   section 5.1.6 derives the nonce from the key and the message). A wallet that signs like this gives a
//   different valid signature each time, which the determinism check before account setup refuses
//   (step 1.7): keys derived from its signature could not be derived again.
import {
  compileTransaction,
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  type KeyPairSigner,
  type Transaction,
  type TransactionMessage,
  type TransactionMessageWithFeePayer,
  type TransactionModifyingSigner,
  type TransactionWithinSizeLimit,
  type TransactionWithLifetime,
} from "@solana/kit";
import sodium from "libsodium-wrappers-sumo";

type SignedTransaction = Transaction & TransactionWithinSizeLimit & TransactionWithLifetime;

/**
 * A keypair behind the wallet signing interface. `modify` receives the decompiled message the app
 * built and returns the message the "wallet" signs instead.
 */
export function keypairWallet(
  signer: KeyPairSigner,
  modify?: (message: TransactionMessage) => TransactionMessage,
): TransactionModifyingSigner {
  return {
    address: signer.address,
    async modifyAndSignTransactions(transactions) {
      return Promise.all(
        transactions.map(async (transaction) => {
          let target: Transaction = transaction;
          if (modify) {
            const message = decompileTransactionMessage(
              getCompiledTransactionMessageDecoder().decode(transaction.messageBytes),
            ) as TransactionMessage;
            target = compileTransaction(
              modify(message) as TransactionMessage & TransactionMessageWithFeePayer,
            );
          }
          const [signatures] = await signer.signTransactions([target as SignedTransaction]);
          return Object.freeze({
            ...target,
            signatures: Object.freeze({ ...target.signatures, ...signatures }),
          }) as SignedTransaction;
        }),
      );
    },
  };
}

/** A valid Ed25519 signature of `message` by the key of `seed`, with a random nonce. */
export async function randomizedEd25519Signature(
  seed: Uint8Array,
  message: Uint8Array,
): Promise<Uint8Array> {
  await sodium.ready;
  const { publicKey } = sodium.crypto_sign_seed_keypair(seed);
  const hash = sodium.crypto_hash_sha512(seed);
  const scalar = new Uint8Array(64);
  scalar.set(hash.subarray(0, 32));
  scalar[0] = (scalar[0] ?? 0) & 248;
  scalar[31] = ((scalar[31] ?? 0) & 127) | 64;
  const a = sodium.crypto_core_ed25519_scalar_reduce(scalar);
  const r = sodium.crypto_core_ed25519_scalar_random();
  const R = sodium.crypto_scalarmult_ed25519_base_noclamp(r);
  const k = sodium.crypto_core_ed25519_scalar_reduce(
    sodium.crypto_hash_sha512(new Uint8Array([...R, ...publicKey, ...message])),
  );
  const S = sodium.crypto_core_ed25519_scalar_add(r, sodium.crypto_core_ed25519_scalar_mul(k, a));
  return new Uint8Array([...R, ...S]);
}
