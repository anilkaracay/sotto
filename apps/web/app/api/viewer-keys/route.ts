// POST /api/viewer-keys { publicKey, signature } (07 section 5): registers the caller's viewing key after
// checking their wallet's registration signature; 201 for a new key, 200 when it is already active.
import { apiRoute } from "../../../lib/server/api-route.ts";
import { readJson } from "../../../lib/server/body.ts";
import { apiErrors } from "../../../lib/server/errors.ts";
import { RATE_LIMITS } from "../../../lib/server/rate-limit.ts";
import { registerViewerKey, viewerKeyRegistrationSchema } from "../../../lib/server/viewer-keys.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ request, session, database }) => {
    if (!session) throw apiErrors.unauthenticated();
    const { data } = await readJson(request, viewerKeyRegistrationSchema);
    const { viewerKey, created } = await registerViewerKey(database(), session, data);
    return Response.json({ viewerKey }, { status: created ? 201 : 200 });
  },
);
