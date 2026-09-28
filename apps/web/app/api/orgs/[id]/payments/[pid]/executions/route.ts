// POST /api/orgs/:id/payments/:pid/executions (owner, active org; 08 section 3; step 1.9): each
// signature of an attempt before its transaction is sent, the end of a failed attempt after its proof
// accounts were closed, and the result of the integrity check after settlement.
import { apiRoute } from "../../../../../../../lib/server/api-route.ts";
import { readJson } from "../../../../../../../lib/server/body.ts";
import { serverCluster } from "../../../../../../../lib/server/cluster.ts";
import { requireMoneyAccess } from "../../../../../../../lib/server/orgs.ts";
import { executionSchema, recordExecution } from "../../../../../../../lib/server/payments.ts";
import { RATE_LIMITS } from "../../../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ request, session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const paymentId = typeof params.pid === "string" ? params.pid : "";
    const db = database();
    await requireMoneyAccess(db, session, orgId, ["owner"]);
    annotate({ orgId });
    const { data } = await readJson(request, executionSchema);
    return Response.json({
      payment: await recordExecution(db, session, orgId, paymentId, data, await serverCluster()),
    });
  },
);
