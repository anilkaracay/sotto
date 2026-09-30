// GET /api/orgs/:id/chain-activity?limit=10 (owner, active org; AC-05.3; step 2.5): what the chain shows
// about the org's accounts, newest first, from chain_activity only. Since step 2.12 (AC-05.2)
// ?flows=public&since=YYYY-MM-DD returns only deposits and withdrawals since that day, oldest first.
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import {
  chainActivityQuerySchema,
  listChainActivity,
  listPublicFlows,
} from "../../../../../lib/server/chain-activity.ts";
import { apiErrors } from "../../../../../lib/server/errors.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { auth: "session" },
  async ({ request, session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    annotate({ orgId });
    const query = chainActivityQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!query.success) {
      const issue = query.error.issues[0];
      throw apiErrors.invalidRequest(
        `Invalid request: ${issue?.path.join(".") || "query"}: ${issue?.message ?? "invalid"}`,
      );
    }
    if (query.data.flows === "public" && !query.data.since) {
      throw apiErrors.invalidRequest("Invalid request: since: required with flows=public");
    }
    const activity =
      query.data.flows === "public" && query.data.since
        ? await listPublicFlows(database(), session, orgId, query.data.since)
        : await listChainActivity(database(), session, orgId, query.data.limit);
    return Response.json({ activity }, { headers: { "cache-control": "no-store" } });
  },
);
