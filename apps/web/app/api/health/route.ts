// GET /api/health (08 section 3): uptime checks. No session, no rate limit, no secret.
import { sql } from "drizzle-orm";
import { apiRoute } from "../../../lib/server/api-route.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute({ auth: "none" }, async ({ database }) => {
  try {
    await database().execute(sql`select 1`);
    return Response.json(
      { status: "ok", database: "ok" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      { status: "degraded", database: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
});
