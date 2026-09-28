// POST /api/invites/:token/accept (session with the recipient's wallet; AC-07.3): adds the recipient
// membership, links the recipient to the user and creates the own_payslips grant.
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import { acceptInvite } from "../../../../../lib/server/invites.ts";
import { RATE_LIMITS } from "../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ session, database, params, annotate }) => {
    const token = typeof params.token === "string" ? params.token : "";
    const accepted = await acceptInvite(database(), session, token);
    annotate({ orgId: accepted.orgId });
    return Response.json({ accepted });
  },
);
