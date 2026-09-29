// POST /api/orgs/:id/exports { grantId, rows, month, category, needsReceipt, searched } (an accountant
// with that active viewing key; AC-11.4; step 2.5): the CSV is generated in the accountant's tab, and
// the server records only the export event in the owner's access log: who, when, the grant's scope,
// the row count and the filters, never a row or the search text.
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import { readJson } from "../../../../../lib/server/body.ts";
import { exportSchema, recordExport } from "../../../../../lib/server/books.ts";
import { requireMoneyAccess } from "../../../../../lib/server/orgs.ts";
import { RATE_LIMITS } from "../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ request, session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const db = database();
    await requireMoneyAccess(db, session, orgId, ["accountant"]);
    annotate({ orgId });
    const { data } = await readJson(request, exportSchema);
    return Response.json(await recordExport(db, session, orgId, data), { status: 201 });
  },
);
