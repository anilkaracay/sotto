// POST /api/approvals { subjectType, subjectId, message, signature } (an owner or approver of the
// payment's org, active org; D-04, Q-12 (a); step 1.9): an approval message signed by the approver's
// wallet over the payment's current contents hash.
import { apiRoute } from "../../../lib/server/api-route.ts";
import { approvalSchema, recordApproval } from "../../../lib/server/approvals.ts";
import { readJson } from "../../../lib/server/body.ts";
import { serverCluster } from "../../../lib/server/cluster.ts";
import { RATE_LIMITS } from "../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ request, session, database }) => {
    const { data } = await readJson(request, approvalSchema);
    return Response.json(await recordApproval(database(), session, data, await serverCluster()), {
      status: 201,
    });
  },
);
