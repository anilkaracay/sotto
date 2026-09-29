// POST /api/orgs/:id/grants/:gid/invite (owner, active org; step 2.4): a new invite link for a grant
// its holder has not accepted yet, shown once; the earlier link stops working.
import { apiRoute } from "../../../../../../../lib/server/api-route.ts";
import { appOriginRequired } from "../../../../../../../lib/server/config.ts";
import { renewGrantInvite } from "../../../../../../../lib/server/grants.ts";
import { RATE_LIMITS } from "../../../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const grantId = typeof params.gid === "string" ? params.gid : "";
    annotate({ orgId });
    return Response.json(
      await renewGrantInvite(database(), session, orgId, grantId, appOriginRequired()),
      { headers: { "cache-control": "no-store" } },
    );
  },
);
