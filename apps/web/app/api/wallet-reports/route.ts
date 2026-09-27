// POST /api/wallet-reports (06 section 9): one diagnostic log line about what a wallet did with a
// signing request, with the wallet name; nothing is stored (204).
import { apiRoute } from "../../../lib/server/api-route.ts";
import { readJson } from "../../../lib/server/body.ts";
import { apiErrors } from "../../../lib/server/errors.ts";
import { RATE_LIMITS } from "../../../lib/server/rate-limit.ts";
import { logWalletReport, walletReportSchema } from "../../../lib/server/wallet-reports.ts";

export const dynamic = "force-dynamic";

export const POST = apiRoute(
  { auth: "session", rateLimits: [RATE_LIMITS.writeSession, RATE_LIMITS.writeIp] },
  async ({ request, requestId, session }) => {
    if (!session) throw apiErrors.unauthenticated();
    const { data } = await readJson(request, walletReportSchema);
    logWalletReport(data, { requestId, userId: session.userId });
    return new Response(null, { status: 204 });
  },
);
