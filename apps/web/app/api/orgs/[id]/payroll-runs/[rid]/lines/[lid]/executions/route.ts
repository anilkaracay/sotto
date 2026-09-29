// POST /api/orgs/:id/payroll-runs/:rid/lines/:lid/executions (owner, active org; 08 section 3; step
// 2.3): each signature of a line's attempt before its transaction is sent, and the end of an attempt
// the page stopped. The first signature of the run makes it executing and records the initiator's
// approval with that execution signature (Q-11, 13 A31).
import { apiRoute } from "../../../../../../../../../lib/server/api-route.ts";
import { readJson } from "../../../../../../../../../lib/server/body.ts";
import { serverCluster } from "../../../../../../../../../lib/server/cluster.ts";
import { requireMoneyAccess } from "../../../../../../../../../lib/server/orgs.ts";
import {
  lineExecutionSchema,
  recordLineExecution,
} from "../../../../../../../../../lib/server/payroll.ts";
import { RATE_LIMITS } from "../../../../../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ request, session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const runId = typeof params.rid === "string" ? params.rid : "";
    const lineId = typeof params.lid === "string" ? params.lid : "";
    const db = database();
    await requireMoneyAccess(db, session, orgId, ["owner"]);
    annotate({ orgId });
    const { data } = await readJson(request, lineExecutionSchema);
    return Response.json({
      run: await recordLineExecution(
        db,
        session,
        orgId,
        runId,
        lineId,
        data,
        await serverCluster(),
      ),
    });
  },
);
