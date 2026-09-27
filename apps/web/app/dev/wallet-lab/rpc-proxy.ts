// Pure checks for the dev only wallet lab RPC proxy (app/dev/wallet-lab/rpc/route.dev.ts).
// Unit tested in test/wallet-lab-rpc.test.ts.

/** The only JSON-RPC methods the wallet lab needs. */
export const LAB_RPC_METHODS = [
  "getLatestBlockhash",
  "sendTransaction",
  "getSignatureStatuses",
  "getBalance",
  "getTransaction",
] as const;

export const RPC_URL_ERROR = "RPC_URL is not set or invalid";

/**
 * RPC_URL in apps/web/.env.local is the Helius devnet URL (ENGINEERING-RULES.md "Local configuration and
 * secrets", 14 section 2). Valid only if the value is an https URL on a helius-rpc.com host and
 * contains "helius-rpc.com" exactly once (a doubled URL was seen in step 0.3). The value itself is
 * never returned in errors.
 */
export function validateRpcUrl(
  value: string | undefined,
): { ok: true; url: string } | { ok: false; error: string } {
  const fail = { ok: false as const, error: RPC_URL_ERROR };
  if (!value) return fail;
  if (value.split("helius-rpc.com").length - 1 !== 1) return fail;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return fail;
  }
  if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".helius-rpc.com")) return fail;
  return { ok: true, url: value };
}

export type LabRpcCheck =
  | { ok: true; method: (typeof LAB_RPC_METHODS)[number] }
  | { ok: false; status: number; error: string };

/** A single JSON-RPC 2.0 request whose method is on the allow list. Batches are refused. */
export function checkLabRpcRequest(body: unknown): LabRpcCheck {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, status: 400, error: "expected a single JSON-RPC request object" };
  }
  const { jsonrpc, method } = body as { jsonrpc?: unknown; method?: unknown };
  if (jsonrpc !== "2.0" || typeof method !== "string") {
    return { ok: false, status: 400, error: "invalid JSON-RPC request" };
  }
  const allowed = LAB_RPC_METHODS.find((m) => m === method);
  if (!allowed) {
    return { ok: false, status: 403, error: `method not allowed: ${method}` };
  }
  return { ok: true, method: allowed };
}
