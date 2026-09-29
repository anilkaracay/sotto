// PUT /api/orgs/:id/reconciliations/:pid { status } (the accountant holding the payment's record, or
// the owner; AC-11.3; step 2.5): matched or needs receipt, no notes (D-27); logged, metadata only.
import { apiRoute } from "../../../../../../lib/server/api-route.ts";
import { readJson } from "../../../../../../lib/server/body.ts";
import { reconciliationSchema, setReconciliation } from "../../../../../../lib/server/books.ts";
import { requireMoneyAccess } from "../../../../../../lib/server/orgs.ts";
import { RATE_LIMITS } from "../../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const PUT = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ request, session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const paymentId = typeof params.pid === "string" ? params.pid : "";
    const db = database();
    await requireMoneyAccess(db, session, orgId, ["owner", "accountant"]);
    annotate({ orgId });
    const { data } = await readJson(request, reconciliationSchema);
    return Response.json({
      reconciliation: await setReconciliation(db, session, orgId, paymentId, data),
    });
  },
);
