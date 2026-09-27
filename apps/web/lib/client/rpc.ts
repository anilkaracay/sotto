// Browser Solana RPC (08 section 3): every call goes through the server's /api/rpc proxy with the
// session cookie, so the browser never holds an RPC URL. HTTP 429 is retried as "network busy,
// retrying" (D-14).
import { createRetryingRpc, type SolanaRpc } from "@sotto/sdk/tx";

let rpc: SolanaRpc | null = null;

export function browserRpc(): SolanaRpc {
  return (rpc ??= createRetryingRpc(new URL("/api/rpc", window.location.origin).href));
}
