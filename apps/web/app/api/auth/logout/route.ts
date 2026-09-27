// POST /api/auth/logout: revokes the session server side (AC-01.3) and clears the cookie.
import { sessions } from "@sotto/db";
import { eq, sql } from "drizzle-orm";
import { apiRoute } from "../../../../lib/server/api-route.ts";
import { RATE_LIMITS } from "../../../../lib/server/rate-limit.ts";
import { clearedSessionCookie } from "../../../../lib/server/session.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "optional", rateLimits: [RATE_LIMITS.authIp] },
  async ({ session, database }) => {
    if (session) {
      await database()
        .update(sessions)
        .set({ revokedAt: sql`now()` })
        .where(eq(sessions.id, session.id));
    }
    return new Response(null, { status: 204, headers: { "set-cookie": clearedSessionCookie() } });
  },
);
