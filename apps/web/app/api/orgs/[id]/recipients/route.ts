// GET /api/orgs/:id/recipients and POST /api/orgs/:id/recipients (owner, active org; F-07, AC-07.1,
// AC-07.2). The money gate is checked before the body is read; a new recipient's readiness is read
// from chain at once.
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import { readJson } from "../../../../../lib/server/body.ts";
import { serverRpc } from "../../../../../lib/server/chain.ts";
import { serverCluster } from "../../../../../lib/server/cluster.ts";
import { requireMoneyAccess } from "../../../../../lib/server/orgs.ts";
import { RATE_LIMITS } from "../../../../../lib/server/rate-limit.ts";
import { createRecipient, listRecipients } from "../../../../../lib/server/recipients.ts";
import { recipientFieldsSchema } from "../../../../../lib/recipient.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { auth: "session" },
  async ({ session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    annotate({ orgId });
    return Response.json(
      { recipients: await listRecipients(database(), session, orgId) },
      { headers: { "cache-control": "no-store" } },
    );
  },
);

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ request, session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const db = database();
    await requireMoneyAccess(db, session, orgId, ["owner"]);
    annotate({ orgId });
    const { data } = await readJson(request, recipientFieldsSchema);
    const recipient = await createRecipient(db, session, orgId, data, {
      rpc: serverRpc(),
      cluster: await serverCluster(),
    });
    return Response.json({ recipient }, { status: 201 });
  },
);
