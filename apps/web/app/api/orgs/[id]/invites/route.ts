// POST /api/orgs/:id/invites { role: "recipient", recipientId } (owner, active org; AC-07.3): a new
// invite link for one recipient, shown once (the database keeps only the token's SHA-256).
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import { readJson } from "../../../../../lib/server/body.ts";
import { appOriginRequired } from "../../../../../lib/server/config.ts";
import { createRecipientInvite, inviteCreateSchema } from "../../../../../lib/server/invites.ts";
import { requireMoneyAccess } from "../../../../../lib/server/orgs.ts";
import { RATE_LIMITS } from "../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ request, session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const db = database();
    await requireMoneyAccess(db, session, orgId, ["owner"]);
    annotate({ orgId });
    const { data } = await readJson(request, inviteCreateSchema);
    const invite = await createRecipientInvite(db, session, orgId, data, appOriginRequired());
    return Response.json({ invite }, { status: 201, headers: { "cache-control": "no-store" } });
  },
);
