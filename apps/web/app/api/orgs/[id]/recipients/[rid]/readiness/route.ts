// POST /api/orgs/:id/recipients/:rid/readiness (owner, active org; AC-07.2): reads the recipient's
// wUSDC account from chain again and stores the readiness.
import { apiRoute } from "../../../../../../../lib/server/api-route.ts";
import { serverRpc } from "../../../../../../../lib/server/chain.ts";
import { serverCluster } from "../../../../../../../lib/server/cluster.ts";
import { RATE_LIMITS } from "../../../../../../../lib/server/rate-limit.ts";
import { checkRecipientReadiness } from "../../../../../../../lib/server/recipients.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const recipientId = typeof params.rid === "string" ? params.rid : "";
    annotate({ orgId });
    return Response.json({
      recipient: await checkRecipientReadiness(database(), session, orgId, recipientId, {
        rpc: serverRpc(),
        cluster: await serverCluster(),
      }),
    });
  },
);
