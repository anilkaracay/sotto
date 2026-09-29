// GET and POST /api/orgs/:id/payroll-runs (owner, active org; F-08, AC-08.1, AC-08.2; step 2.3). POST
// creates a draft run from the lines the page validated from the CSV: a recipient of the org per line,
// a client made idempotency key for the run and for each line, and each line's amount, memo, gross and
// tax sealed to the owner's viewing key. The same run key returns the same run (I-7).
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import { readJson } from "../../../../../lib/server/body.ts";
import { serverCluster } from "../../../../../lib/server/cluster.ts";
import { requireMoneyAccess } from "../../../../../lib/server/orgs.ts";
import {
  createRun,
  listRuns,
  PAYROLL_MAX_BODY_BYTES,
  payrollRunCreateSchema,
} from "../../../../../lib/server/payroll.ts";
import { RATE_LIMITS } from "../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { auth: "session" },
  async ({ session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    annotate({ orgId });
    return Response.json(
      { runs: await listRuns(database(), session, orgId) },
      { headers: { "cache-control": "no-store" } },
    );
  },
);

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ request, session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const db = database();
    await requireMoneyAccess(db, session, orgId, ["owner"]);
    annotate({ orgId });
    const { data } = await readJson(request, payrollRunCreateSchema, PAYROLL_MAX_BODY_BYTES);
    const { run, created } = await createRun(db, session, orgId, data, await serverCluster());
    return Response.json({ run }, { status: created ? 201 : 200 });
  },
);
