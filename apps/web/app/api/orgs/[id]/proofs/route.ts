// GET /api/orgs/:id/proofs: the organization's issued proofs of funds with each record's state read
// from chain now (valid, expired, closed). POST /api/orgs/:id/proofs { recordAddress,
// counterpartyLabel, counterpartySalt }: after the owner's tab wrote a record, the server checks it
// against the chain and its counterparty hash and stores the label and salt, which never go
// onchain (F-13, AC-13.1; step 2.8). The owner of an active organization only.
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import { readJson } from "../../../../../lib/server/body.ts";
import { serverRpc } from "../../../../../lib/server/chain.ts";
import { serverCluster } from "../../../../../lib/server/cluster.ts";
import { listProofs, recordProof, recordProofSchema } from "../../../../../lib/server/proofs.ts";
import { RATE_LIMITS } from "../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { auth: "session" },
  async ({ session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    annotate({ orgId });
    return Response.json(await listProofs(database(), session, orgId, serverRpc()), {
      headers: { "cache-control": "no-store" },
    });
  },
);

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ request, session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    annotate({ orgId });
    const { data } = await readJson(request, recordProofSchema);
    return Response.json(
      await recordProof(database(), session, orgId, data, serverRpc(), await serverCluster()),
      { status: 201 },
    );
  },
);
