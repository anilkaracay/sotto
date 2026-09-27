// POST /api/admin/orgs/:id/approve, /reject and /suspend (Sotto admins, D-09). The decision is one
// conditional status update (409 org_status_conflict otherwise); the worker's sas-issue job then
// issues or closes the attestation (AC-02.3, AC-02.4). The request log line names the org and the
// action.
import { apiRoute } from "./api-route.ts";
import { decideOrg, requireAdmin, type AdminAction } from "./orgs.ts";
import { RATE_LIMITS } from "./rate-limit.ts";

export function adminDecisionRoute(action: AdminAction) {
  return apiRoute(
    { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
    async ({ session, database, params, annotate }) => {
      const db = database();
      const admin = await requireAdmin(db, session);
      const orgId = typeof params.id === "string" ? params.id : "";
      annotate({ orgId, action });
      return Response.json({ org: await decideOrg(db, orgId, action, admin.wallet) });
    },
  );
}
