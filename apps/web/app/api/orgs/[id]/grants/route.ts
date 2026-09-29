// GET and POST /api/orgs/:id/grants (owner, active org; F-10, AC-10.1, AC-10.2; step 2.4). POST names
// the holder, the scope (all_payments, period with its dates, payroll_only) and the expiry (30 days,
// the end of the quarter or the year, or none) and answers with the grant and its invite link, shown
// once. GET lists the org's grants with their holders, statuses, record counts and what a back fill
// still has to share, and the owner's own record count the coverage bars compare with.
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import { readJson } from "../../../../../lib/server/body.ts";
import { appOriginRequired } from "../../../../../lib/server/config.ts";
import { createGrant, grantCreateSchema, listGrants } from "../../../../../lib/server/grants.ts";
import { requireMoneyAccess } from "../../../../../lib/server/orgs.ts";
import { RATE_LIMITS } from "../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { auth: "session" },
  async ({ session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    annotate({ orgId });
    return Response.json(await listGrants(database(), session, orgId), {
      headers: { "cache-control": "no-store" },
    });
  },
);

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ request, session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const db = database();
    await requireMoneyAccess(db, session, orgId, ["owner"]);
    annotate({ orgId });
    const { data } = await readJson(request, grantCreateSchema);
    const created = await createGrant(db, session, orgId, data, appOriginRequired());
    return Response.json(created, { status: 201, headers: { "cache-control": "no-store" } });
  },
);
