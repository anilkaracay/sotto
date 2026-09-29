// GET /api/orgs/:id/access-log?days=7 (owner, active org; F-14, AC-14.1; step 2.4): what happened in
// the org, newest first, at most 100 events: grants, back fills and record batches, payments and
// payroll runs, approvals. Metadata only, never amounts.
import { accessLogQuerySchema, listAccessLog } from "../../../../../lib/server/access-log.ts";
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import { apiErrors } from "../../../../../lib/server/errors.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { auth: "session" },
  async ({ request, session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    annotate({ orgId });
    const query = accessLogQuerySchema.safeParse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    if (!query.success) {
      const issue = query.error.issues[0];
      throw apiErrors.invalidRequest(
        `Invalid request: ${issue?.path.join(".") || "query"}: ${issue?.message ?? "invalid"}`,
      );
    }
    return Response.json(
      { events: await listAccessLog(database(), session, orgId, query.data.days) },
      { headers: { "cache-control": "no-store" } },
    );
  },
);
