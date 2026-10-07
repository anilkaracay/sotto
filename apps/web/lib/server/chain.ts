// Server side chain reads (08 section 3): the server's own RPC client on RPC_URL, which
// never reaches the browser. HTTP 429 is retried as "network busy, retrying" (D-14).
import { createRetryingRpc, type SolanaRpc } from "@sotto/sdk/tx";
import { rpcUrl } from "./config.ts";

let cached: { url: string; rpc: SolanaRpc } | null = null;

export function serverRpc(): SolanaRpc {
  const url = rpcUrl();
  if (cached?.url !== url) cached = { url, rpc: createRetryingRpc(url) };
  return cached.rpc;
}
