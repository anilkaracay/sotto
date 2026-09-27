// POST /api/admin/orgs/:id/approve (Sotto admins) approves an organization in review: it becomes
// active, and the worker issues its attestation (AC-02.3).
import { adminDecisionRoute } from "../../../../../../lib/server/admin-decision.ts";

export const dynamic = "force-dynamic";

export const POST = adminDecisionRoute("approve");
