// POST /api/orgs (AC-02.1): a signed in user creates an organization with its KYB fields. It starts
// in review, the creator becomes Owner, and a wallet owns at most one organization (409
// org_exists).
import { apiRoute } from "../../../lib/server/api-route.ts";
import { readJson } from "../../../lib/server/body.ts";
import { apiErrors } from "../../../lib/server/errors.ts";
import { createOrg } from "../../../lib/server/orgs.ts";
import { RATE_LIMITS } from "../../../lib/server/rate-limit.ts";
import { orgCreateSchema } from "../../../lib/org.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ request, session, database, annotate }) => {
    if (!session) throw apiErrors.unauthenticated();
    const { data } = await readJson(request, orgCreateSchema);
    const org = await createOrg(database(), session.userId, data);
    annotate({ orgId: org.id });
    return Response.json({ org }, { status: 201 });
  },
);
