// PATCH and DELETE /api/orgs/:id/recipients/:rid (owner, active org; F-07). The wallet does not change;
// a recipient who joined cannot be removed in this build (409 recipient_joined).
import { apiRoute } from "../../../../../../lib/server/api-route.ts";
import { readJson } from "../../../../../../lib/server/body.ts";
import { requireMoneyAccess } from "../../../../../../lib/server/orgs.ts";
import { RATE_LIMITS } from "../../../../../../lib/server/rate-limit.ts";
import { deleteRecipient, updateRecipient } from "../../../../../../lib/server/recipients.ts";
import { recipientUpdateSchema } from "../../../../../../lib/recipient.ts";

export const dynamic = "force-dynamic";

export const PATCH = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ request, session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const recipientId = typeof params.rid === "string" ? params.rid : "";
    const db = database();
    await requireMoneyAccess(db, session, orgId, ["owner"]);
    annotate({ orgId });
    const { data } = await readJson(request, recipientUpdateSchema);
    return Response.json({
      recipient: await updateRecipient(db, session, orgId, recipientId, data),
    });
  },
);

export const DELETE = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const recipientId = typeof params.rid === "string" ? params.rid : "";
    annotate({ orgId });
    await deleteRecipient(database(), session, orgId, recipientId);
    return new Response(null, { status: 204 });
  },
);
