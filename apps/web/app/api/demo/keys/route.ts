// GET /api/demo/keys (step 4.6, D-32): the demo company's published viewing keys, labelled as what they
// are: devnet demo keys of three demo wallets, derived viewing keys that open sealed records and can
// do nothing else. Public, read only, devnet only, and only for the organization the server's demo
// file names (404 demo_unavailable anywhere else).
import { apiRoute } from "../../../../lib/server/api-route.ts";
import { serverCluster } from "../../../../lib/server/cluster.ts";
import { demoErrors, demoKeys, loadDemoCompany } from "../../../../lib/server/demo.ts";
import { RATE_LIMITS } from "../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { auth: "none", demo: true, rateLimits: [RATE_LIMITS.publicReadIp] },
  async ({ database }) => {
    const demo = await loadDemoCompany(database(), await serverCluster());
    if (!demo) throw demoErrors.unavailable();
    return Response.json(demoKeys(demo), { headers: { "cache-control": "no-store" } });
  },
);
