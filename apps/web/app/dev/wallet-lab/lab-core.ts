// Transaction and signature helpers for the dev only wallet lab. This module calls the public devnet
// RPC directly, which is allowed only here (step 0.6); production code goes through /api/rpc.
import {
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  getBase16Decoder,
  getBase64EncodedWireTransaction,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  getTransactionEncoder,
  lamports,
  pipe,
  setTransactionMessageConfig,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signatureBytes,
  verifySignature,
  type Address,
  type Transaction,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";

export const DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const DEVNET_CHAIN = "solana:devnet";
/** Test wallet funded for Gate G2 (same seed phrase in Phantom, Solflare and Backpack). */
export const TEST_ADDRESS = "71GuHKz8HqEKvGbMwQQTiNpqQbMvEu89pSvUcv71QbLh";
/** v1 limits for a self transfer: v1 budgets zero when unset (facts D3). */
export const V1_COMPUTE_UNIT_LIMIT = 10_000;
export const V1_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 65_536;

const rpc = createSolanaRpc(DEVNET_RPC_URL);

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function toHex(bytes: Uint8Array): string {
  return getBase16Decoder().decode(bytes);
}

/** The exact three line D-03 fallback message (docs/03-DECISIONS.md) for a wallet address. */
export function d03Message(walletAddress: string): string {
  return [
    "sotto-conf-keys/v1",
    "This signature unlocks your Sotto confidential balances. Sign it only in the official Sotto app.",
    `Wallet: ${walletAddress}`,
  ].join("\n");
}

export async function verifyEd25519(
  signer: string,
  signature: Uint8Array,
  data: Uint8Array,
): Promise<boolean> {
  const key = await getPublicKeyFromAddress(address(signer));
  return verifySignature(key, signatureBytes(signature), data);
}

export async function latestBlockhash() {
  const { value } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  return value;
}

/** A self transfer of `amount` lamports, compiled and encoded as wire bytes for the wallet. */
export function buildSelfTransfer(
  owner: string,
  version: 0 | 1,
  blockhash: Awaited<ReturnType<typeof latestBlockhash>>,
  amount: bigint,
): { wire: Uint8Array; messageBytes: Uint8Array } {
  const ownerAddress: Address = address(owner);
  const instruction = getTransferSolInstruction({
    source: createNoopSigner(ownerAddress),
    destination: ownerAddress,
    amount: lamports(amount),
  });
  const transaction =
    version === 1
      ? compileTransaction(
          pipe(
            createTransactionMessage({ version: 1 }),
            (m) => setTransactionMessageFeePayer(ownerAddress, m),
            (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
            (m) => appendTransactionMessageInstruction(instruction, m),
            (m) =>
              setTransactionMessageConfig(
                {
                  computeUnitLimit: V1_COMPUTE_UNIT_LIMIT,
                  loadedAccountsDataSizeLimit: V1_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
                },
                m,
              ),
          ),
        )
      : compileTransaction(
          pipe(
            createTransactionMessage({ version: 0 }),
            (m) => setTransactionMessageFeePayer(ownerAddress, m),
            (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
            (m) => appendTransactionMessageInstruction(instruction, m),
          ),
        );
  return {
    wire: new Uint8Array(getTransactionEncoder().encode(transaction)),
    messageBytes: new Uint8Array(transaction.messageBytes),
  };
}

export function decodeTransaction(wire: Uint8Array): Transaction {
  return getTransactionDecoder().decode(wire);
}

export type SignedCheck = {
  signatureHex: string;
  signatureValid: boolean;
  messageUnchanged: boolean;
};

/** Checks the owner's signature on a signed transaction and whether the wallet changed the message. */
export async function checkSignedTransaction(
  owner: string,
  signedWire: Uint8Array,
  originalMessage: Uint8Array,
): Promise<{ check: SignedCheck; transaction: Transaction }> {
  const transaction = decodeTransaction(signedWire);
  const signature = transaction.signatures[address(owner)];
  if (!signature)
    throw new Error("no signature for the connected account in the signed transaction");
  const messageBytes = new Uint8Array(transaction.messageBytes);
  return {
    transaction,
    check: {
      signatureHex: toHex(new Uint8Array(signature)),
      signatureValid: await verifyEd25519(owner, new Uint8Array(signature), messageBytes),
      messageUnchanged: toHex(messageBytes) === toHex(originalMessage),
    },
  };
}

/** Sends a signed transaction to devnet and waits until it is confirmed (polling, 60 seconds). */
export async function sendAndConfirm(transaction: Transaction): Promise<string> {
  const signature = await rpc
    .sendTransaction(getBase64EncodedWireTransaction(transaction), {
      encoding: "base64",
      preflightCommitment: "confirmed",
    })
    .send();
  for (let i = 0; i < 60; i++) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) throw new Error(`transaction failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return signature;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`not confirmed within 60 seconds: ${signature}`);
}
