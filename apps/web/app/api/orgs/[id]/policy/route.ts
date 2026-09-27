// PUT /api/orgs/:id/policy (owner): sets the organization's approval policy (D-04). The hackathon
// build accepts only the default of 1 and refuses anything higher with 422
// approval_policy_not_available (Q-12). Membership is checked before the body is read.
import { orgPolicy } from "@sotto/db";
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import { readJson } from "../../../../../lib/server/body.ts";
import { requireMembership } from "../../../../../lib/server/membership.ts";
import { approvalPolicySchema, assertPolicyAvailable } from "../../../../../lib/server/policy.ts";
import { RATE_LIMITS } from "../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const PUT = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ request, session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const db = database();
    await requireMembership(db, session, orgId, ["owner"]);
    annotate({ orgId });
    const { data } = await readJson(request, approvalPolicySchema);
    assertPolicyAvailable(data);
    const [row] = await db
      .insert(orgPolicy)
      .values({ orgId, ...data })
      .onConflictDoUpdate({ target: orgPolicy.orgId, set: data })
      .returning({
        paymentApprovalsRequired: orgPolicy.paymentApprovalsRequired,
        payrollApprovalsRequired: orgPolicy.payrollApprovalsRequired,
      });
    return Response.json(row);
  },
);
