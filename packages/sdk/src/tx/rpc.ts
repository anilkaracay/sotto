// RPC client with HTTP 429 retries (D-14): rate limit errors are retried with exponential backoff and
// reported as "network busy, retrying", never as a wallet failure. Since step 4.9 a request also has
// a time limit: one that gets no answer is given up and tried again like a busy network, so a page
// never waits on a single request without end. A sendTransaction with no answer is not sent again:
// the caller looks the signature up instead, since the transaction may have been accepted.
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

/** A request with no answer within this time is given up (step 4.9). */
export const RPC_REQUEST_TIMEOUT_MS = 20_000;

export type RetryNotice = (retry: number, maxRetries: number, delayMs: number) => void;

/** The network gave no answer to a request in time. */
export class RpcTimeoutError extends Error {
  readonly method: string;
  constructor(method: string, timeoutMs: number) {
    super(`the network did not answer ${method} within ${timeoutMs / 1000} seconds`);
    this.name = "RpcTimeoutError";
    this.method = method;
  }
}

const methodOf = (config: Parameters<RpcTransport>[0]): string => {
  const payload = config.payload as { method?: unknown } | undefined;
  return typeof payload?.method === "string" ? payload.method : "a request";
};

/** One request with its time limit: the inner request is aborted when the limit passes. */
async function withTimeout(
  inner: RpcTransport,
  config: Parameters<RpcTransport>[0],
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const outer = config.signal;
  if (outer?.aborted) controller.abort(outer.reason);
  else outer?.addEventListener("abort", () => controller.abort(outer.reason), { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new RpcTimeoutError(methodOf(config), timeoutMs));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([inner({ ...config, signal: controller.signal }), late]);
  } finally {
    clearTimeout(timer);
  }
}

export function isRateLimited(error: unknown): boolean {
  return (
    isSolanaError(error, SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR) &&
    error.context.statusCode === 429
  );
}

/**
 * Wraps a transport so HTTP 429 responses, and requests that get no answer in time, are retried with
 * exponential backoff.
 */
export function retryingTransport(
  inner: RpcTransport,
  onRetry?: RetryNotice,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs: number = RPC_REQUEST_TIMEOUT_MS,
): RpcTransport {
  const transport = async (config: Parameters<RpcTransport>[0]) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await withTimeout(inner, config, timeoutMs);
      } catch (error) {
        const late = error instanceof RpcTimeoutError && error.method !== "sendTransaction";
        if (!(isRateLimited(error) || late) || attempt >= MAX_RPC_RETRIES) throw error;
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
