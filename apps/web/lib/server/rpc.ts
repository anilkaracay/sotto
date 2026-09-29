// Browser Solana RPC goes through /api/rpc (X-54, 08 section 3): a single JSON-RPC 2.0 request per
// call, a method allow list, a per session rate limit and a body size limit. The upstream is RPC_URL,
// which never reaches the browser or a response. Upstream 429 stays 429, so the client's retrying
// transport backs off (D-14).
import { z } from "zod";
import { ApiError } from "./errors.ts";

/**
 * Methods the Phase 1 browser flows need: startup verification (06 section 0), transaction building,
 * simulation, sending and confirmation (06 section 9), balances. Since step 2.3 `getBlockHeight`:
 * a payroll chunk starts a line only while its blockhash still has blocks left (06 section 7). Heavy
 * or abusable methods (getProgramAccounts, requestAirdrop, getSignaturesForAddress) are not allowed.
 */
export const RPC_METHODS = [
  "getAccountInfo",
  "getBalance",
  "getBlock",
  "getBlockHeight",
  "getGenesisHash",
  "getLatestBlockhash",
  "getMinimumBalanceForRentExemption",
  "getMultipleAccounts",
  "getRecentPrioritizationFees",
  "getSignatureStatuses",
  "getTokenAccountBalance",
  "getTransaction",
  "sendTransaction",
  "simulateTransaction",
] as const;

export type RpcMethod = (typeof RPC_METHODS)[number];

/** Enough for a 4096 byte v1 transaction in base64 or 100 addresses. */
export const RPC_MAX_BODY_BYTES = 32_768;
export const RPC_UPSTREAM_TIMEOUT_MS = 20_000;

export const rpcRequestSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string().max(64), z.number().int(), z.null()]),
    method: z.string().min(1).max(64),
    params: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
  })
  .strict();

export function isAllowedRpcMethod(method: string): method is RpcMethod {
  return (RPC_METHODS as readonly string[]).includes(method);
}

export const rpcErrors = {
  methodNotAllowed: () => new ApiError(403, "rpc_method_not_allowed", "RPC method not allowed"),
  upstreamBusy: () => new ApiError(429, "rpc_upstream_busy", "Network busy, retrying"),
  upstreamError: () => new ApiError(502, "rpc_upstream_error", "RPC provider error"),
  upstreamTimeout: () => new ApiError(504, "rpc_upstream_timeout", "RPC provider timed out"),
};

/** Forwards a validated JSON-RPC body; the upstream URL never appears in a response or an error. */
export async function forwardRpc(upstreamUrl: string, body: string): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(RPC_UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError")
      throw rpcErrors.upstreamTimeout();
    throw rpcErrors.upstreamError();
  }
  if (upstream.status === 429) throw rpcErrors.upstreamBusy();
  if (!upstream.ok) throw rpcErrors.upstreamError();
  return new Response(await upstream.text(), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
