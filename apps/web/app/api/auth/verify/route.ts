// POST /api/auth/verify { wallet, message, signature } (base64): verifies a signed sign in message
// (AC-01.1), consumes its nonce once (AC-01.2), and starts a session in an httpOnly, Secure,
// SameSite=Lax cookie (D-15).
import { authNonces, users } from "@sotto/db";
import { getBase64Encoder } from "@solana/kit";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { apiRoute } from "../../../../lib/server/api-route.ts";
import { checkSignedSignIn } from "../../../../lib/server/auth.ts";
import { readJson } from "../../../../lib/server/body.ts";
import { appOriginRequired, sessionSecret } from "../../../../lib/server/config.ts";
import { ApiError } from "../../../../lib/server/errors.ts";
import { RATE_LIMITS } from "../../../../lib/server/rate-limit.ts";
import { createSession, sessionCookie } from "../../../../lib/server/session.ts";

export const dynamic = "force-dynamic";

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const verifyRequest = z
  .object({
    wallet: z.string().min(32).max(44),
    message: z.string().max(4096).regex(BASE64),
    signature: z.string().max(128).regex(BASE64),
  })
  .strict();

const signInInvalid = () =>
  new ApiError(
    401,
    "sign_in_invalid",
    "Sign in failed: the signed message does not match. Start again.",
  );
const signInExpired = () =>
  new ApiError(401, "sign_in_expired", "Sign in request expired or already used. Start again.");

export const POST = apiRoute(
  { auth: "none", rateLimits: [RATE_LIMITS.authIp] },
  async ({ request, database, annotate }) => {
    const origin = appOriginRequired();
    const secret = sessionSecret();
    const { data } = await readJson(request, verifyRequest, 8192);
    const decode = getBase64Encoder();
    const message = new Uint8Array(decode.encode(data.message));
    const signature = new Uint8Array(decode.encode(data.signature));
    const check = await checkSignedSignIn({ origin, wallet: data.wallet, message, signature });
    if (!check.ok) {
      annotate({ signInFailure: check.reason });
      throw signInInvalid();
    }
    const db = database();
    const consumed = await db
      .update(authNonces)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(authNonces.nonce, check.nonce),
          eq(authNonces.wallet, data.wallet),
          isNull(authNonces.usedAt),
          gt(authNonces.expiresAt, sql`now()`),
          eq(authNonces.expiresAt, check.expiresAt),
        ),
      )
      .returning({ nonce: authNonces.nonce });
    if (consumed.length === 0) throw signInExpired();
    const [user] = await db
      .insert(users)
      .values({ wallet: data.wallet })
      .onConflictDoUpdate({ target: users.wallet, set: { wallet: data.wallet } })
      .returning({ id: users.id, wallet: users.wallet, displayName: users.displayName });
    if (!user) throw new Error("user upsert returned no row");
    annotate({ userId: user.id });
    const { token, expiresAt } = await createSession(db, user.id, secret);
    return Response.json(
      { user },
      { headers: { "set-cookie": sessionCookie(token, expiresAt), "cache-control": "no-store" } },
    );
  },
);
