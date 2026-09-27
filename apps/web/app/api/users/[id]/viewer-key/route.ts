// GET /api/users/:id/viewer-key (07 section 5, 08 section 3): the user's active viewing key with its
// registration signature, for that user or an owner of an org the user belongs to. Browsers verify the
// signature before encrypting to the key (I-8).
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import { apiErrors } from "../../../../../lib/server/errors.ts";
import { readViewerKey } from "../../../../../lib/server/viewer-keys.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { auth: "session" },
  async ({ session, database, params, annotate }) => {
    if (!session) throw apiErrors.unauthenticated();
    const userId = typeof params.id === "string" ? params.id : "";
    annotate({ targetUserId: userId });
    return Response.json(
      { viewerKey: await readViewerKey(database(), session, userId) },
      { headers: { "cache-control": "no-store" } },
    );
  },
);
