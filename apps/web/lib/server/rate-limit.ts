// Rate limits (08 sections 3 and 6): fixed windows counted in Postgres (rate_limits), so every server
// instance shares them. Keys are HMACs of the subject (session ID or client IP), never raw values.
import { createHmac } from "node:crypto";
import { rateLimits, type Database } from "@sotto/db";
import { sql } from "drizzle-orm";

export type RateLimitPolicy = {
  name: string;
  limit: number;
  windowSeconds: number;
  by: "session" | "ip";
};

/** Defaults (08 section 6); tune with evidence. */
export const RATE_LIMITS = {
  authIp: { name: "auth-ip", limit: 20, windowSeconds: 60, by: "ip" },
  writeSession: { name: "write-session", limit: 60, windowSeconds: 60, by: "session" },
  writeIp: { name: "write-ip", limit: 120, windowSeconds: 60, by: "ip" },
  rpcSession: { name: "rpc-session", limit: 600, windowSeconds: 60, by: "session" },
  /** Step 2.8: the public proof verification (no session), which reads the chain per request. */
  publicReadIp: { name: "public-read-ip", limit: 60, windowSeconds: 60, by: "ip" },
  /** Step 3.2: request access from the landing, a few per address and hour. */
  waitlistIp: { name: "waitlist-ip", limit: 10, windowSeconds: 3600, by: "ip" },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitResult = { allowed: boolean; count: number; retryAfterSeconds: number };

export function rateLimitKey(policy: RateLimitPolicy, subject: string, secret: string): string {
  return `${policy.name}:${createHmac("sha256", secret).update(`${policy.by}:${subject}`).digest("hex")}`;
}

export async function consumeRateLimit(
  db: Database,
  policy: RateLimitPolicy,
  subject: string,
  secret: string,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const windowMs = policy.windowSeconds * 1000;
  const windowStart = new Date(Math.floor(now / windowMs) * windowMs);
  const [row] = await db
    .insert(rateLimits)
    .values({ key: rateLimitKey(policy, subject, secret), windowStart, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.windowStart} = excluded.window_start then ${rateLimits.count} + 1 else 1 end`,
        windowStart: sql`excluded.window_start`,
      },
    })
    .returning({ count: rateLimits.count });
  const count = row?.count ?? 1;
  return {
    allowed: count <= policy.limit,
    count,
    retryAfterSeconds: Math.max(1, Math.ceil((windowStart.getTime() + windowMs - now) / 1000)),
  };
}

/** Client IP: the first x-forwarded-for entry (set by the platform on Vercel), else x-real-ip. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}
