// Dev only JSON-RPC proxy for the wallet lab: forwards allow listed methods to RPC_URL from
// apps/web/.env.local (Next.js env loading).
// Guarded like the lab page. The upstream URL is never returned or logged.
import { notFound } from "next/navigation";
import { checkLabRpcRequest, validateRpcUrl } from "../rpc-proxy";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 65_536;

// The message is also the HTTP reason phrase: @solana/kit reports only the status text of a non 2xx
// response, so this is what the lab's result cell shows.
function jsonRpcError(status: number, message: string, id: unknown = null): Response {
  return Response.json(
    { jsonrpc: "2.0", id, error: { code: -32000, message } },
    { status, statusText: message },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.NODE_ENV !== "development") {
    notFound();
  }
  const upstream = validateRpcUrl(process.env.RPC_URL);
  if (!upstream.ok) return jsonRpcError(500, upstream.error);

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return jsonRpcError(413, "request too large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return jsonRpcError(400, "invalid JSON");
  }
  const id =
    typeof body === "object" && body !== null ? ((body as { id?: unknown }).id ?? null) : null;
  const check = checkLabRpcRequest(body);
  if (!check.ok) return jsonRpcError(check.status, check.error, id);

  let response: Response;
  try {
    response = await fetch(upstream.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
      cache: "no-store",
    });
  } catch {
    // The fetch error can name the host; only a generic message leaves this route.
    return jsonRpcError(502, "upstream request failed", id);
  }
  return new Response(await response.text(), {
    status: response.status,
    statusText: response.statusText,
    headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
  });
}
