// GET /api/orgs/:id (any active member) and PATCH /api/orgs/:id (owner). The legal name, country,
// registration number and website change only while the org is in review (409 org_details_locked).
// Membership is checked before the body is read.
import { apiRoute } from "../../../../lib/server/api-route.ts";
import { readJson } from "../../../../lib/server/body.ts";
import { requireMembership } from "../../../../lib/server/membership.ts";
import { readOrg, updateOrg } from "../../../../lib/server/orgs.ts";
import { RATE_LIMITS } from "../../../../lib/server/rate-limit.ts";
import { orgUpdateSchema } from "../../../../lib/org.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { auth: "session" },
  async ({ session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    annotate({ orgId });
    return Response.json(await readOrg(database(), session, orgId), {
      headers: { "cache-control": "no-store" },
    });
  },
);

export const PATCH = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ request, session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const db = database();
    await requireMembership(db, session, orgId, ["owner"]);
    annotate({ orgId });
    const { data } = await readJson(request, orgUpdateSchema);
    return Response.json({ org: await updateOrg(db, session, orgId, data) });
  },
);
