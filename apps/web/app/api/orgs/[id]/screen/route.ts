// POST /api/orgs/:id/screen { wallets[] } (owner, active org; D-10, AC-06.2; step 1.9): screens the
// wallets now with the cluster's provider (the deny list off mainnet) and stores each result.
import { isAddress } from "@solana/kit";
import { z } from "zod";
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import { readJson } from "../../../../../lib/server/body.ts";
import { serverCluster } from "../../../../../lib/server/cluster.ts";
import { requireMoneyAccess } from "../../../../../lib/server/orgs.ts";
import { RATE_LIMITS } from "../../../../../lib/server/rate-limit.ts";
import { screeningProvider, screenWallet } from "../../../../../lib/server/screening.ts";

export const dynamic = "force-dynamic";

const screenSchema = z
  .object({
    wallets: z
      .array(z.string().refine((value) => isAddress(value), "must be a Solana address"))
      .min(1)
      .max(100),
  })
  .strict();

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ request, session, database, params, annotate }) => {
    const orgId = typeof params.id === "string" ? params.id : "";
    const db = database();
    await requireMoneyAccess(db, session, orgId, ["owner"]);
    annotate({ orgId });
    const { data } = await readJson(request, screenSchema);
    const cluster = await serverCluster();
    const provider = screeningProvider(cluster?.config.name ?? "mainnet");
    const results = [];
    for (const wallet of [...new Set(data.wallets)]) {
      results.push({ wallet, result: await screenWallet(db, orgId, wallet, provider) });
    }
    return Response.json({ provider, results });
  },
);
