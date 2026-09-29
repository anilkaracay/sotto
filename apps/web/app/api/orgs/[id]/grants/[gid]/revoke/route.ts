// POST /api/orgs/:id/grants/:gid/revoke (owner, active org; AC-10.4, AC-10.5; step 2.4): the grant's
// records are deleted in the same database transaction and the grant is revoked; what the holder
// already viewed cannot be erased, which the page says.
import { apiRoute } from "../../../../../../../lib/server/api-route.ts";
import { revokeGrant } from "../../../../../../../lib/server/grants.ts";
import { RATE_LIMITS } from "../../../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const grantId = typeof params.gid === "string" ? params.gid : "";
    annotate({ orgId });
    return Response.json({ grant: await revokeGrant(database(), session, orgId, grantId) });
  },
);
