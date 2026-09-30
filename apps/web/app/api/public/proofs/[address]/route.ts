// GET /api/public/proofs/:address (no sign in; F-13, AC-13.3; step 2.8): the public view of a proof
// record from chain: the statement's threshold, slot, time and expiry, the organization's legal name
// from its SAS attestation (X-21), the record's state, and "none" for the balance disclosed. The
// database adds only the counterparty label.
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import { serverRpc } from "../../../../../lib/server/chain.ts";
import { serverCluster } from "../../../../../lib/server/cluster.ts";
import { labelLookup, readPublicProof } from "../../../../../lib/server/proofs.ts";
import { RATE_LIMITS } from "../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { auth: "none", rateLimits: [RATE_LIMITS.publicReadIp] },
  async ({ database, params }) => {
    const raw = typeof params.address === "string" ? params.address : "";
    const view = await readPublicProof(serverRpc(), await serverCluster(), raw, {
      label: labelLookup(database()),
    });
    return Response.json(view, { headers: { "cache-control": "no-store" } });
  },
);
