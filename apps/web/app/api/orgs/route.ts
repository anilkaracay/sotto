// POST /api/orgs (AC-02.1): a signed in user creates an organization with its KYB fields. It starts
// in review, the creator becomes Owner, and a wallet owns at most one organization (409
// org_exists). Step 4.3 (D-29): its asset, USDC unless another of the network's registry is chosen
// (422 asset_unavailable for an asset this network does not have).
import { DEFAULT_ASSET } from "@sotto/sdk/cluster/assets";
import { apiRoute } from "../../../lib/server/api-route.ts";
import { readJson } from "../../../lib/server/body.ts";
import { apiErrors } from "../../../lib/server/errors.ts";
import { clusterAsset, serverCluster } from "../../../lib/server/cluster.ts";
import { createOrg, orgErrors } from "../../../lib/server/orgs.ts";
import { RATE_LIMITS } from "../../../lib/server/rate-limit.ts";
import { orgCreateSchema } from "../../../lib/org.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ request, session, database, annotate }) => {
    if (!session) throw apiErrors.unauthenticated();
    const { data } = await readJson(request, orgCreateSchema);
    if (data.asset && data.asset !== DEFAULT_ASSET) {
      const cluster = await serverCluster();
      if (!cluster || !clusterAsset(cluster, data.asset)) throw orgErrors.assetUnavailable();
    }
    const org = await createOrg(database(), session.userId, data);
    annotate({ orgId: org.id });
    return Response.json({ org }, { status: 201 });
  },
);
