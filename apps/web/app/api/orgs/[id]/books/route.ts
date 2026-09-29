// GET /api/orgs/:id/books (an accountant with an active viewing key in an active org; F-11, AC-11.1 to
// AC-11.3; step 2.5): the scope banner's grants and the metadata of exactly the payments the caller
// holds a record of. The amounts are only in the caller's records (GET /orgs/:id/disclosures).
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import { readBooks } from "../../../../../lib/server/books.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { auth: "session" },
  async ({ session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    annotate({ orgId });
    return Response.json(await readBooks(database(), session, orgId), {
      headers: { "cache-control": "no-store" },
    });
  },
);
