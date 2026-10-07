// POST /api/admin/orgs/:id/reject (Sotto admins) rejects an organization in review: it becomes
// suspended, the hackathon build's rejected state.
import { adminDecisionRoute } from "../../../../../../lib/server/admin-decision.ts";

export const dynamic = "force-dynamic";

export const POST = adminDecisionRoute("reject");
