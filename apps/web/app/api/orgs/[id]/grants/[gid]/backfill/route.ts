// GET /api/orgs/:id/grants/:gid/backfill (owner, active org; AC-10.3; step 2.4): the owner's own
// records in the grant's scope that the grant has none of yet, at most 500 (one manifest), with their
// manifests, for the owner's browser to verify, open and seal again to the holder.
import { apiRoute } from "../../../../../../../lib/server/api-route.ts";
import { backfillItems } from "../../../../../../../lib/server/grants.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { auth: "session" },
  async ({ session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const grantId = typeof params.gid === "string" ? params.gid : "";
    annotate({ orgId });
    return Response.json(await backfillItems(database(), session, orgId, grantId), {
      headers: { "cache-control": "no-store" },
    });
  },
);
