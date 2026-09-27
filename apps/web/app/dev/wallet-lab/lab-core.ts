// Transaction and signature helpers for the dev only wallet lab. RPC calls go to the dev only proxy
// /dev/wallet-lab/rpc, which forwards allow listed methods to RPC_URL. Production code
// goes through /api/rpc.
import {
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createNoopSigner,
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  createTransactionMessage,
  getBase16Decoder,
  getBase64EncodedWireTransaction,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  getTransactionEncoder,
  isSolanaError,
  lamports,
  pipe,
  setTransactionMessageConfig,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signatureBytes,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  verifySignature,
  type Address,
  type RpcTransport,
  type Transaction,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";

/** Dev only proxy route (app/dev/wallet-lab/rpc/route.ts). */
export const LAB_RPC_PATH = "/dev/wallet-lab/rpc";
export const LAB_RPC_DESCRIPTION = `devnet through ${LAB_RPC_PATH} (RPC_URL)`;
/** 429 handling: up to 3 retries with exponential backoff (1 s, 2 s, 4 s). */
export const MAX_RPC_RETRIES = 3;
export const RETRY_BASE_DELAY_MS = 1000;
export const DEVNET_CHAIN = "solana:devnet";
/** Test wallet funded for Gate G2 (same seed phrase in Phantom, Solflare and Backpack). */
export const TEST_ADDRESS = "71GuHKz8HqEKvGbMwQQTiNpqQbMvEu89pSvUcv71QbLh";
/** v1 limits for a self transfer: v1 budgets zero when unset (facts D3). */
export const V1_COMPUTE_UNIT_LIMIT = 10_000;
export const V1_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 65_536;

export type RetryNotice = (retry: number, maxRetries: number, delayMs: number) => void;

export function isRateLimited(error: unknown): boolean {
  return (
    isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) &&
    error.context.statusCode === 429
  );
}

/** Wraps a transport so HTTP 429 responses are retried with exponential backoff. */
export function retryingTransport(
  inner: RpcTransport,
  onRetry?: RetryNotice,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): RpcTransport {
  const transport = async (config: Parameters<RpcTransport>[0]) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await inner(config);
      } catch (error) {
        if (!isRateLimited(error) || attempt >= MAX_RPC_RETRIES) throw error;
        const delay = RETRY_BASE_DELAY_MS * 2 ** attempt;
        onRetry?.(attempt + 1, MAX_RPC_RETRIES, delay);
        await sleep(delay);
      }
    }
  };
  return transport as RpcTransport;
}

function labRpc(onRetry?: RetryNotice) {
  const origin = typeof window === "undefined" ? "http://localhost:3000" : window.location.origin;
  return createSolanaRpcFromTransport(
    retryingTransport(createDefaultRpcTransport({ url: `${origin}${LAB_RPC_PATH}` }), onRetry),
  );
}

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

export async function latestBlockhash(onRetry?: RetryNotice) {
  const { value } = await labRpc(onRetry).getLatestBlockhash({ commitment: "confirmed" }).send();
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

/** Sends a signed transaction to devnet and waits until it is confirmed (polling, 90 seconds). */
export async function sendAndConfirm(
  transaction: Transaction,
  onRetry?: RetryNotice,
): Promise<string> {
  const rpc = labRpc(onRetry);
  const signature = await rpc
    .sendTransaction(getBase64EncodedWireTransaction(transaction), {
      encoding: "base64",
      preflightCommitment: "confirmed",
    })
    .send();
  for (let i = 0; i < 45; i++) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) throw new Error(`transaction failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return signature;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`not confirmed within 90 seconds: ${signature}`);
}
