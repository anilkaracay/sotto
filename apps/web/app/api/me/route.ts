// GET /api/me: the signed in user, their memberships and admin flag (08 section 3).
import { apiRoute } from "../../../lib/server/api-route.ts";
import { loadMe } from "../../../lib/server/me.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute({ auth: "session" }, async ({ session, database }) => {
  if (!session) throw new Error("unreachable: apiRoute requires a session");
  return Response.json(await loadMe(database(), session), {
    headers: { "cache-control": "no-store" },
  });
});
