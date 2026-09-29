// POST /api/orgs/:id/payroll-runs/:rid/authorize (owner, active org; step 2.3): before anything is
// signed, every line still to pay is ready from chain now and screened clear, the approvals are met
// and the proof program is available; a resume first reads the chain for earlier transfers, so a line
// that landed is never sent again (AC-08.5, I-7).
import { apiRoute } from "../../../../../../../lib/server/api-route.ts";
import { serverRpc } from "../../../../../../../lib/server/chain.ts";
import { serverCluster } from "../../../../../../../lib/server/cluster.ts";
import { authorizeRun } from "../../../../../../../lib/server/payroll.ts";
import { RATE_LIMITS } from "../../../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const runId = typeof params.rid === "string" ? params.rid : "";
    annotate({ orgId });
    const run = await authorizeRun(database(), session, orgId, runId, {
      rpc: serverRpc(),
      cluster: await serverCluster(),
    });
    return Response.json({ authorized: true, run });
  },
);
