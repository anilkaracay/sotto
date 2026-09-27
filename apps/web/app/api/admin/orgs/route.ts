// GET /api/admin/orgs?status= (Sotto admins, the admins table): the organizations for KYB review
// (D-09), oldest first, at most ADMIN_LIST_LIMIT with a truncated flag.
import { z } from "zod";
import { apiRoute } from "../../../../lib/server/api-route.ts";
import { apiErrors } from "../../../../lib/server/errors.ts";
import { listOrgsForAdmin, requireAdmin } from "../../../../lib/server/orgs.ts";

export const dynamic = "force-dynamic";

const statusParam = z.enum(["pending_review", "active", "suspended"]).nullable();

export const GET = apiRoute({ auth: "session" }, async ({ request, session, database }) => {
  const db = database();
  await requireAdmin(db, session);
  const status = statusParam.safeParse(new URL(request.url).searchParams.get("status"));
  if (!status.success) {
    throw apiErrors.invalidRequest("status must be pending_review, active or suspended");
  }
  return Response.json(await listOrgsForAdmin(db, status.data), {
    headers: { "cache-control": "no-store" },
  });
});
