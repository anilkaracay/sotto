// The faucet's devnet SOL (step 4.6, D-31): GET whether the signed in wallet may ask now, its balance
// and its last grants; POST queues one grant of 0.05 SOL to that wallet, which the worker sends.
// Devnet only (403 sol_faucet_devnet_only on any other cluster); one grant per wallet per 24 hours
// (429 sol_faucet_limit), only while the wallet holds less than 0.02 SOL (409 sol_faucet_not_needed),
// 1 SOL for all wallets per 24 hours (429 sol_faucet_daily_total), and a few requests a day per
// address. The body is empty: the wallet is the session's and the amount is fixed.
import { apiRoute } from "../../../../lib/server/api-route.ts";
import { serverRpc } from "../../../../lib/server/chain.ts";
import { serverCluster } from "../../../../lib/server/cluster.ts";
import { RATE_LIMITS } from "../../../../lib/server/rate-limit.ts";
import { readSolFaucet, requestSolGrant } from "../../../../lib/server/sol-faucet.ts";

export const dynamic = "force-dynamic";

export const GET = apiRoute({ auth: "session" }, async ({ session, database }) =>
  Response.json(
    { faucet: await readSolFaucet(database(), session, await serverCluster(), serverRpc) },
    { headers: { "cache-control": "no-store" } },
  ),
);

export const POST = apiRoute(
  {
    auth: "session",
    rateLimits: [
      RATE_LIMITS.solFaucetIp,
      RATE_LIMITS.faucetSession,
      RATE_LIMITS.writeSession,
      RATE_LIMITS.writeIp,
    ],
  },
  async ({ session, database }) =>
    Response.json(
      { grant: await requestSolGrant(database(), session, await serverCluster(), serverRpc) },
      { status: 202 },
    ),
);
