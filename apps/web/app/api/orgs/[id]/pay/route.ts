// GET /api/orgs/:id/pay (a recipient of an active org; F-12, AC-12.1, AC-12.2; step 2.6): the
// settlement dates and readers of the payments to the caller, and the org's transfers into the
// caller's account as the chain shows them. The amounts are only in the caller's records.
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import { serverCluster } from "../../../../../lib/server/cluster.ts";
import { readPay } from "../../../../../lib/server/pay.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { auth: "session" },
  async ({ session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    annotate({ orgId });
    return Response.json(await readPay(database(), session, orgId, await serverCluster()), {
      headers: { "cache-control": "no-store" },
    });
  },
);
