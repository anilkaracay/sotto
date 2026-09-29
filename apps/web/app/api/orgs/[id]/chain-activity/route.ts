// GET /api/orgs/:id/chain-activity?limit=10 (owner, active org; AC-05.3; step 2.5): what the chain shows
// about the org's accounts, newest first, from chain_activity only.
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import {
  chainActivityQuerySchema,
  listChainActivity,
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
    return Response.json(
      { activity: await listChainActivity(database(), session, orgId, query.data.limit) },
      { headers: { "cache-control": "no-store" } },
    );
  },
);
