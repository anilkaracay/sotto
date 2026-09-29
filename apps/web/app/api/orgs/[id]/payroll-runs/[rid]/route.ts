// GET /api/orgs/:id/payroll-runs/:rid (owner, active org; step 2.3): the run with its lines in order,
// each line's status, attempts and sealed blob, whether the owner's disclosure of the line exists, the
// contents hash approvals sign and the approvals (AC-08.2, AC-08.4).
import { apiRoute } from "../../../../../../lib/server/api-route.ts";
import { serverCluster } from "../../../../../../lib/server/cluster.ts";
import { readRun } from "../../../../../../lib/server/payroll.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { auth: "session" },
  async ({ session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const runId = typeof params.rid === "string" ? params.rid : "";
    annotate({ orgId });
    return Response.json(
      { run: await readRun(database(), session, orgId, runId, await serverCluster()) },
      { headers: { "cache-control": "no-store" } },
    );
  },
);
