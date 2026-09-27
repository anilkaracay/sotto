// POST /api/auth/nonce { wallet }: issues a sign in message (08 section 3, D-15) that expires after 5
// minutes. Returns the fields for solana:signIn and the same message as text for solana:signMessage.
import { authNonces } from "@sotto/db";
import { isAddress } from "@solana/kit";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { apiRoute } from "../../../../lib/server/api-route.ts";
import { newSignInNonce, signInInput, signInMessageText } from "../../../../lib/server/auth.ts";
import { readJson } from "../../../../lib/server/body.ts";
import { appOriginRequired } from "../../../../lib/server/config.ts";
import { RATE_LIMITS } from "../../../../lib/server/rate-limit.ts";

export const dynamic = "force-dynamic";

const nonceRequest = z
  .object({ wallet: z.string().refine((value) => isAddress(value), "must be a Solana address") })
  .strict();

export const POST = apiRoute(
  { auth: "none", rateLimits: [RATE_LIMITS.authIp] },
  async ({ request, database }) => {
    const origin = appOriginRequired();
    const { data } = await readJson(request, nonceRequest, 1024);
    const db = database();
    const nonce = newSignInNonce();
    const input = signInInput(origin, data.wallet, nonce, new Date());
    await db
      .insert(authNonces)
      .values({ nonce, wallet: data.wallet, expiresAt: new Date(input.expirationTime ?? "") });
    // Expired nonces are useless; drop old ones while here.
    await db.delete(authNonces).where(sql`${authNonces.expiresAt} < now() - interval '1 hour'`);
    return Response.json(
      { input, message: signInMessageText(input) },
      { headers: { "cache-control": "no-store" } },
    );
  },
);
