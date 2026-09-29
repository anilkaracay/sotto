// DELETE /api/orgs/:id/payroll-runs/:rid/lines/:lid (owner, active org; step 2.3): removes a line
// from a run that never started, for example a line blocked at authorization; a run keeps at least
// one line.
import { apiRoute } from "../../../../../../../../lib/server/api-route.ts";
import { serverCluster } from "../../../../../../../../lib/server/cluster.ts";
import { removeLine } from "../../../../../../../../lib/server/payroll.ts";
import { RATE_LIMITS } from "../../../../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const DELETE = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const runId = typeof params.rid === "string" ? params.rid : "";
    const lineId = typeof params.lid === "string" ? params.lid : "";
    annotate({ orgId });
    return Response.json({
      run: await removeLine(database(), session, orgId, runId, lineId, await serverCluster()),
    });
  },
);
