// RPC client with HTTP 429 retries (D-14): rate limit errors are retried with exponential backoff and
// reported as "network busy, retrying", never as a wallet failure.
import {
  createDefaultRpcTransport,
  createSolanaRpcFromTransport,
  isSolanaError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  type RpcTransport,
} from "@solana/kit";

/** Up to 3 retries with exponential backoff: 1 s, 2 s, 4 s. */
export const MAX_RPC_RETRIES = 3;
export const RETRY_BASE_DELAY_MS = 1000;

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

/** A Solana RPC client whose transport retries HTTP 429. The URL comes from the caller's config. */
export function createRetryingRpc(url: string, options: { onRetry?: RetryNotice } = {}) {
  return createSolanaRpcFromTransport(
    retryingTransport(createDefaultRpcTransport({ url }), options.onRetry),
  );
}

export type SolanaRpc = ReturnType<typeof createRetryingRpc>;
