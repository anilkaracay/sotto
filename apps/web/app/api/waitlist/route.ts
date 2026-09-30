// POST /api/waitlist { email, company, consent: true } (F-17, AC-17.2; step 3.2): request access from
// the landing, no session, same origin, rate limited per address. 201 { ok: true } for a new or a
// repeated email alike; the email never reaches a log (lib/server/waitlist.ts).
import { apiRoute } from "../../../lib/server/api-route.ts";
import { readJson } from "../../../lib/server/body.ts";
import { RATE_LIMITS } from "../../../lib/server/rate-limit.ts";
import { addToWaitlist, waitlistRequestSchema } from "../../../lib/server/waitlist.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "none", rateLimits: [RATE_LIMITS.waitlistIp] },
  async ({ request, database }) => {
    const { data } = await readJson(request, waitlistRequestSchema, 2048);
    await addToWaitlist(database(), data);
    return Response.json({ ok: true }, { status: 201, headers: { "cache-control": "no-store" } });
  },
);
