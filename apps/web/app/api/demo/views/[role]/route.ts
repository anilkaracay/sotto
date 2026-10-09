// GET /api/demo/views/:role (step 4.6, D-32): what one role of the demo company reads, as the signed
// in app would give it to that role: the sealed records (ciphertexts the browser opens with the
// role's published viewing key), their manifests and the public rows around them. `compare` is one
// payment from every role's side. Public, read only (each view runs in a READ ONLY transaction),
// devnet only (404 demo_unavailable anywhere else).
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import { serverCluster } from "../../../../../lib/server/cluster.ts";
import {
  DEMO_ROLES,
  demoCompareView,
  demoErrors,
  demoRoleView,
  loadDemoCompany,
  type DemoRole,
} from "../../../../../lib/server/demo.ts";
import { RATE_LIMITS } from "../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute(
  { auth: "none", demo: true, rateLimits: [RATE_LIMITS.publicReadIp] },
  async ({ database, params, annotate }) => {
    const role = typeof params.role === "string" ? params.role : "";
    annotate({ demoView: role });
    const cluster = await serverCluster();
    const demo = await loadDemoCompany(database(), cluster);
    if (!demo || !cluster) throw demoErrors.unavailable();
    const view =
      role === "compare"
        ? await demoCompareView(database(), demo, cluster)
        : (DEMO_ROLES as readonly string[]).includes(role)
          ? await demoRoleView(database(), demo, role as DemoRole, cluster)
          : null;
    if (!view) throw demoErrors.unknownRole();
    return Response.json({ view }, { headers: { "cache-control": "no-store" } });
  },
);
