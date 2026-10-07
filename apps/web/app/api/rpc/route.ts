// POST /api/rpc: the JSON-RPC proxy for all browser Solana RPC (08 section 3). Session required,
// Origin checked, per session rate limit, body size limit, method allow list; forwards to RPC_URL.
import { apiRoute } from "../../../lib/server/api-route.ts";
import { readJson } from "../../../lib/server/body.ts";
import { rpcUrl } from "../../../lib/server/config.ts";
import { RATE_LIMITS } from "../../../lib/server/rate-limit.ts";
import {
  forwardRpc,
  isAllowedRpcMethod,
  RPC_MAX_BODY_BYTES,
  rpcErrors,
  rpcRequestSchema,
} from "../../../lib/server/rpc.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.rpcSession] },
  async ({ request, annotate }) => {
    const upstream = rpcUrl();
    const { data, text } = await readJson(request, rpcRequestSchema, RPC_MAX_BODY_BYTES);
    if (!isAllowedRpcMethod(data.method)) throw rpcErrors.methodNotAllowed();
    annotate({ rpcMethod: data.method });
    return forwardRpc(upstream, text);
  },
);
