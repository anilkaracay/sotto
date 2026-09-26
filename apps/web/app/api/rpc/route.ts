// JSON-RPC proxy (X-54, docs/08-BACKEND.md section 3). The method allow list, rate limit and body size
// limit arrive in Phase 1; until then every request is refused.
export function POST(): Response {
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32601, message: "RPC proxy not implemented" } },
    { status: 501 },
  );
}
