// GET /api/orgs/:id/activity?limit=8 (owner, active org; 09 section 3; step 2.5): the latest payments of
// both kinds with who else can read each amount, and the owner's own records of them.
import { activityQuerySchema, listActivity } from "../../../../../lib/server/activity.ts";
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import { apiErrors } from "../../../../../lib/server/errors.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { auth: "session" },
  async ({ request, session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    annotate({ orgId });
    const query = activityQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!query.success) {
      const issue = query.error.issues[0];
      throw apiErrors.invalidRequest(
        `Invalid request: ${issue?.path.join(".") || "query"}: ${issue?.message ?? "invalid"}`,
      );
    }
    return Response.json(await listActivity(database(), session, orgId, query.data.limit), {
      headers: { "cache-control": "no-store" },
    });
  },
);
