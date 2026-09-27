// POST /api/admin/orgs/:id/suspend (Sotto admins) revokes an active organization's verification: it
// becomes suspended, and the worker closes its attestation (AC-02.4).
import { adminDecisionRoute } from "../../../../../../lib/server/admin-decision.ts";

export const dynamic = "force-dynamic";

export const POST = adminDecisionRoute("suspend");
