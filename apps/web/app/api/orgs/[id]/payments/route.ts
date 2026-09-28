// GET and POST /api/orgs/:id/payments (owner, active org; F-06, AC-06.1; step 1.9). POST creates a
// draft for one recipient with a client made idempotency key and the amount and memo sealed to the
// owner's viewing key; the same key returns the same draft (I-7).
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import { readJson } from "../../../../../lib/server/body.ts";
import { serverCluster } from "../../../../../lib/server/cluster.ts";
import { requireMoneyAccess } from "../../../../../lib/server/orgs.ts";
import {
  createPayment,
  listPayments,
  paymentCreateSchema,
} from "../../../../../lib/server/payments.ts";
import { RATE_LIMITS } from "../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { auth: "session" },
  async ({ session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    annotate({ orgId });
    return Response.json(
      { payments: await listPayments(database(), session, orgId, await serverCluster()) },
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
    const { data } = await readJson(request, paymentCreateSchema);
    const { payment, created } = await createPayment(
      db,
      session,
      orgId,
      data,
      await serverCluster(),
    );
    return Response.json({ payment }, { status: created ? 201 : 200 });
  },
);
