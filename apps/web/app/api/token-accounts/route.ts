// POST /api/token-accounts { orgId, address, keyScheme } (08 section 3): records the owner's configured
// wUSDC account after the onchain checks; 201 when new, 200 when it was already recorded.
import { apiRoute } from "../../../lib/server/api-route.ts";
import { readJson } from "../../../lib/server/body.ts";
import { serverRpc } from "../../../lib/server/chain.ts";
import { serverCluster } from "../../../lib/server/cluster.ts";
import { apiErrors } from "../../../lib/server/errors.ts";
import { RATE_LIMITS } from "../../../lib/server/rate-limit.ts";
import {
  registerTokenAccount,
  tokenAccountRegistrationSchema,
} from "../../../lib/server/token-accounts.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ request, session, database, annotate }) => {
    if (!session) throw apiErrors.unauthenticated();
    const { data } = await readJson(request, tokenAccountRegistrationSchema);
    annotate({ orgId: data.orgId });
    const { tokenAccount, created } = await registerTokenAccount(
      database(),
      session,
      serverRpc(),
      await serverCluster(),
      data,
    );
    return Response.json({ tokenAccount }, { status: created ? 201 : 200 });
  },
);
