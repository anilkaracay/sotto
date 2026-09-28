// GET /api/invites/:token (no session needed; auth limits per IP): what the invite page shows before
// sign in: the organization, the role, the recipient's name and wallet, the expiry and the status.
import { apiRoute } from "../../../../lib/server/api-route.ts";
import { readInvite } from "../../../../lib/server/invites.ts";
import { RATE_LIMITS } from "../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { auth: "optional", rateLimits: [RATE_LIMITS.authIp] },
  async ({ session, database, params }) => {
    const token = typeof params.token === "string" ? params.token : "";
    return Response.json(
      { invite: await readInvite(database(), token, session) },
      { headers: { "cache-control": "no-store" } },
    );
  },
);
