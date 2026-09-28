// GET /api/orgs/:id/payments/:pid (owner, active org; step 1.9): the payment with its attempts, the
// contents hash approvals sign and the approval count.
import { apiRoute } from "../../../../../../lib/server/api-route.ts";
import { serverCluster } from "../../../../../../lib/server/cluster.ts";
import { readPayment } from "../../../../../../lib/server/payments.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { auth: "session" },
  async ({ session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const paymentId = typeof params.pid === "string" ? params.pid : "";
    annotate({ orgId });
    return Response.json(
      { payment: await readPayment(database(), session, orgId, paymentId, await serverCluster()) },
      { headers: { "cache-control": "no-store" } },
    );
  },
);
