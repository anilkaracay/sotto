// GET and POST /api/orgs/:id/disclosures (07 sections 4 and 5, 08 section 3; step 1.8). POST (owner,
// active org) stores a batch whose manifest the org owner's wallet signed; GET (any member of an active
// org) returns the caller's own items with their manifests.
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import { readJson } from "../../../../../lib/server/body.ts";
import {
  createDisclosures,
  DISCLOSURE_MAX_BODY_BYTES,
  disclosurePostSchema,
  disclosureQuerySchema,
  listDisclosures,
} from "../../../../../lib/server/disclosures.ts";
import { apiErrors } from "../../../../../lib/server/errors.ts";
import { requireMoneyAccess } from "../../../../../lib/server/orgs.ts";
import { RATE_LIMITS } from "../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { auth: "session" },
  async ({ request, session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    annotate({ orgId });
    const query = disclosureQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!query.success) {
      const issue = query.error.issues[0];
      throw apiErrors.invalidRequest(
        `Invalid request: ${issue?.path.join(".") || "query"}: ${issue?.message ?? "invalid"}`,
      );
    }
    return Response.json(await listDisclosures(database(), session, orgId, query.data), {
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
    const { data } = await readJson(request, disclosurePostSchema, DISCLOSURE_MAX_BODY_BYTES);
    return Response.json(await createDisclosures(db, session, orgId, data), { status: 201 });
  },
);
