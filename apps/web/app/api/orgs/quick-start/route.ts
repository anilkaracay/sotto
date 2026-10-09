// POST /api/orgs/quick-start (step 4.6, D-33): on the devnet configuration, a signed in wallet that
// belongs to no organization gets one made for it, "My company", verified at once (D-30), in the
// devnet test dollar where the network has it. No body. A wallet that owns an organization gets that
// one back (200); a member of another organization is refused (409 quick_start_not_new); any other
// configuration refuses (403 quick_start_devnet_only), where the onboarding form and the review stay.
// Step 4.8 (D-34): a new company in the devnet test dollar starts with the demo recipient, Atlas
// Freight's demo wallet, its readiness read from chain as for any new recipient.
import { DEFAULT_ASSET } from "@sotto/sdk/cluster/assets";
import { DEMO_RECIPIENT } from "../../../../lib/demo.ts";
import { apiRoute } from "../../../../lib/server/api-route.ts";
import { serverRpc } from "../../../../lib/server/chain.ts";
import { apiErrors } from "../../../../lib/server/errors.ts";
import { clusterAsset, serverCluster } from "../../../../lib/server/cluster.ts";
import { orgErrors, quickStartOrg } from "../../../../lib/server/orgs.ts";
import { RATE_LIMITS } from "../../../../lib/server/rate-limit.ts";
import { readinessFromChain } from "../../../../lib/server/recipients.ts";
import { verificationOnCreate } from "../../../../lib/org.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ session, database, annotate }) => {
    if (!session) throw apiErrors.unauthenticated();
    const cluster = await serverCluster();
    if (!cluster || verificationOnCreate(cluster.config.name) !== "automatic") {
      throw orgErrors.quickStartDevnetOnly();
    }
    const devusd = clusterAsset(cluster, "devusd");
    const asset = devusd ? "devusd" : DEFAULT_ASSET;
    const org = await quickStartOrg(database(), session.userId, asset, () =>
      readinessFromChain(serverRpc(), devusd?.wrappedMint ?? null, DEMO_RECIPIENT.wallet),
    );
    annotate({ orgId: org.id, quickStart: true });
    return Response.json({ org }, { status: 200 });
  },
);
