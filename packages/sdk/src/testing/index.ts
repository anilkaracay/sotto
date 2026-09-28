// Test helpers (tests only, never imported by app code):
// - a wallet stand in backed by a keypair, which signs transactions through the same modifying signer
//   interface as a browser wallet (@solana/react), optionally changing the message first, like a
//   wallet that adds its own compute budget or rewrites an instruction (06 section 9);
// - a valid Ed25519 signature made with a random nonce instead of the deterministic one (RFC 8032
//   section 5.1.6 derives the nonce from the key and the message). A wallet that signs like this gives a
//   different valid signature each time, which the determinism check before account setup refuses
//   (step 1.7): keys derived from its signature could not be derived again;
// - Token-2022 accounts with a confidential extension: balances encrypted to given keys, or zero
//   ciphertexts for checks of public fields, and their account data.
import {
  AccountState,
  getMintEncoder,
  getTokenEncoder,
  type Token,
} from "@solana-program/token-2022";
import {
  compileTransaction,
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getAddressEncoder,
  none,
  some,
  type Address,
  type KeyPairSigner,
  type Transaction,
  type TransactionMessage,
  type TransactionMessageWithFeePayer,
  type TransactionModifyingSigner,
  type TransactionWithinSizeLimit,
  type TransactionWithLifetime,
} from "@solana/kit";
import { AeKey, ElGamalPubkey } from "@solana/zk-sdk/bundler";
import sodium from "libsodium-wrappers-sumo";
import type { ConfidentialKeyMaterial } from "../keys/confidential.ts";

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

/** A random X25519 viewer keypair (07 section 2), as a viewing key would be. */
export async function viewerKeypair(): Promise<{ publicKey: Uint8Array; secretKey: Uint8Array }> {
  await sodium.ready;
  const pair = sodium.crypto_box_keypair();
  return { publicKey: pair.publicKey, secretKey: pair.privateKey };
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

/** A token account with confidential balances encrypted to `keys` (amounts in base units). */
export function encryptedTokenAccount(input: {
  owner: Address;
  mint: Address;
  keys: ConfidentialKeyMaterial;
  available: bigint;
  pending: bigint;
  pendingBalanceCreditCounter?: bigint;
  maximumPendingBalanceCreditCounter?: bigint;
  publicAmount?: bigint;
}): Token {
  const pubkey = ElGamalPubkey.fromBytes(
    new Uint8Array(getAddressEncoder().encode(input.keys.elgamalPubkey)),
  );
  const aesKey = AeKey.fromBytes(input.keys.aeKey);
  const low = input.pending & 0xffffn;
  const high = input.pending >> 16n;
  try {
    return {
      mint: input.mint,
      owner: input.owner,
      amount: input.publicAmount ?? 0n,
      delegate: none(),
      state: AccountState.Initialized,
      isNative: none(),
      delegatedAmount: 0n,
      closeAuthority: none(),
      extensions: some([
        {
          __kind: "ConfidentialTransferAccount",
          approved: true,
          elgamalPubkey: input.keys.elgamalPubkey,
          pendingBalanceLow: pubkey.encryptU64(low).toBytes(),
          pendingBalanceHigh: pubkey.encryptU64(high).toBytes(),
          availableBalance: pubkey.encryptU64(input.available).toBytes(),
          decryptableAvailableBalance: aesKey.encrypt(input.available).toBytes(),
          allowConfidentialCredits: true,
          allowNonConfidentialCredits: true,
          pendingBalanceCreditCounter: input.pendingBalanceCreditCounter ?? 0n,
          maximumPendingBalanceCreditCounter: input.maximumPendingBalanceCreditCounter ?? 65_536n,
          expectedPendingBalanceCreditCounter: 0n,
          actualPendingBalanceCreditCounter: 0n,
        },
      ]),
    };
  } finally {
    pubkey.free();
    aesKey.free();
  }
}

/**
 * A token account with a ConfidentialTransferAccount extension and zero ciphertexts, for checks that
 * read only its public fields (no keys needed); `null` leaves the extension out.
 */
export function confidentialTokenAccount(input: {
  owner: Address;
  mint: Address;
  elgamalPubkey: Address;
  approved?: boolean;
  pendingBalanceCreditCounter?: bigint;
  maximumPendingBalanceCreditCounter?: bigint;
  confidential?: boolean;
}): Token {
  const zero = new Uint8Array(64);
  return {
    mint: input.mint,
    owner: input.owner,
    amount: 0n,
    delegate: none(),
    state: AccountState.Initialized,
    isNative: none(),
    delegatedAmount: 0n,
    closeAuthority: none(),
    extensions:
      input.confidential === false
        ? none()
        : some([
            {
              __kind: "ConfidentialTransferAccount",
              approved: input.approved ?? true,
              elgamalPubkey: input.elgamalPubkey,
              pendingBalanceLow: zero,
              pendingBalanceHigh: zero,
              availableBalance: zero,
              decryptableAvailableBalance: new Uint8Array(36),
              allowConfidentialCredits: true,
              allowNonConfidentialCredits: true,
              pendingBalanceCreditCounter: input.pendingBalanceCreditCounter ?? 0n,
              maximumPendingBalanceCreditCounter:
                input.maximumPendingBalanceCreditCounter ?? 65_536n,
              expectedPendingBalanceCreditCounter: 0n,
              actualPendingBalanceCreditCounter: 0n,
            },
          ]),
  };
}

/** A Token-2022 account as the bytes an RPC returns for it. */
export function encodeToken2022Account(token: Token): Uint8Array {
  return new Uint8Array(getTokenEncoder().encode(token));
}

/** A Token-2022 mint with confidential transfers and no auditor (D-01), as the bytes an RPC returns. */
export function encodeConfidentialMint(input: { decimals: number }): Uint8Array {
  return new Uint8Array(
    getMintEncoder().encode({
      mintAuthority: none(),
      supply: 0n,
      decimals: input.decimals,
      isInitialized: true,
      freezeAuthority: none(),
      extensions: some([
        {
          __kind: "ConfidentialTransferMint",
          authority: none(),
          autoApproveNewAccounts: true,
          auditorElgamalPubkey: none(),
        },
      ]),
    }),
  );
}
