// POST /api/orgs/:id/payroll-runs/:rid/executions (owner, active org; step 2.3): the page stopped the
// run before every line landed (the run becomes partially settled or not paid, and can be resumed),
// or the result of a chunk's integrity check (06 section 7).
import { apiRoute } from "../../../../../../../lib/server/api-route.ts";
import { readJson } from "../../../../../../../lib/server/body.ts";
import { serverCluster } from "../../../../../../../lib/server/cluster.ts";
import { requireMoneyAccess } from "../../../../../../../lib/server/orgs.ts";
import { recordRunExecution, runExecutionSchema } from "../../../../../../../lib/server/payroll.ts";
import { RATE_LIMITS } from "../../../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ request, session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const runId = typeof params.rid === "string" ? params.rid : "";
    const db = database();
    await requireMoneyAccess(db, session, orgId, ["owner"]);
    annotate({ orgId });
    const { data } = await readJson(request, runExecutionSchema);
    return Response.json({
      run: await recordRunExecution(db, session, orgId, runId, data, await serverCluster()),
    });
  },
);
