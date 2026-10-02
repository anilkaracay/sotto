// The devUSD faucet (step 4.3, D-29): GET what the owner's wallet may still get in the current 24
// hours and its last requests; POST { amount } (whole or decimal devUSD) queues a mint to the owner's
// wallet, which the worker sends. Devnet only (403 faucet_devnet_only on any other cluster), the owner
// of an active devUSD organization only, at most 10,000 devUSD per wallet per 24 hours (429
// faucet_limit), and rate limited per session.
import { parseTokenAmount } from "@sotto/sdk/confidential/public";
import { z } from "zod";
import { apiRoute } from "../../../../../lib/server/api-route.ts";
import { readJson } from "../../../../../lib/server/body.ts";
import { serverRpc } from "../../../../../lib/server/chain.ts";
import { serverCluster } from "../../../../../lib/server/cluster.ts";
import { readFaucet, requestFaucet } from "../../../../../lib/server/faucet.ts";
import { RATE_LIMITS } from "../../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

const faucetRequestSchema = z
  .object({
    amount: z
      .string("Enter an amount of devUSD")
      .refine((value) => (parseTokenAmount(value, 6) ?? 0n) > 0n, "Enter an amount of devUSD"),
  })
  .strict();

const orgIdOf = (params: Record<string, string | string[] | undefined>) =>
  typeof params.id === "string" ? params.id : "";

export const GET = apiRoute(
  { auth: "session" },
  async ({ session, database, params, annotate }) => {
    const orgId = orgIdOf(params);
    annotate({ orgId });
    return Response.json(
      { faucet: await readFaucet(database(), session, await serverCluster(), serverRpc, orgId) },
      { headers: { "cache-control": "no-store" } },
    );
  },
);

export const POST = apiRoute(
  {
    auth: "session",
    rateLimits: [RATE_LIMITS.faucetSession, RATE_LIMITS.writeSession, RATE_LIMITS.writeIp],
  },
  async ({ request, session, database, params, annotate }) => {
    const orgId = orgIdOf(params);
    annotate({ orgId });
    const { data } = await readJson(request, faucetRequestSchema);
    const mint = await requestFaucet(
      database(),
      session,
      await serverCluster(),
      serverRpc,
      orgId,
      parseTokenAmount(data.amount, 6) as bigint,
    );
    return Response.json({ mint }, { status: 202 });
  },
);
