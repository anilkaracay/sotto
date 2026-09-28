// POST /api/orgs/:id/payments/:pid/authorize (owner, active org; AC-06.2, AC-06.3; step 1.9): the
// recipient ready from chain now, screening clear, approvals met, the proof program available.
import { apiRoute } from "../../../../../../../lib/server/api-route.ts";
import { serverRpc } from "../../../../../../../lib/server/chain.ts";
import { serverCluster } from "../../../../../../../lib/server/cluster.ts";
import { authorizePayment } from "../../../../../../../lib/server/payments.ts";
import { RATE_LIMITS } from "../../../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const paymentId = typeof params.pid === "string" ? params.pid : "";
    annotate({ orgId });
    const payment = await authorizePayment(database(), session, orgId, paymentId, {
      rpc: serverRpc(),
      cluster: await serverCluster(),
    });
    return Response.json({ authorized: true, payment });
  },
);
