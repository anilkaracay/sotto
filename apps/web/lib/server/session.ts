// Sessions (D-15, 04 section 5): an opaque random token in an httpOnly, Secure, SameSite=Lax cookie.
// The database stores only HMAC-SHA256(SESSION_SECRET, token) as sessions.id, so a database leak does
// not reveal usable tokens. Idle timeout 12 hours, absolute lifetime 7 days.
import { createHmac, randomBytes } from "node:crypto";
import { sessions, users, type Database } from "@sotto/db";
import { and, eq, gt, isNull } from "drizzle-orm";

export const SESSION_COOKIE = "sotto_session";
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
/** last_seen_at is refreshed at most this often, to avoid a write on every request. */
const LAST_SEEN_REFRESH_MS = 5 * 60 * 1000;

export type Session = { id: string; userId: string; wallet: string };

export function sessionIdFromToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim() || null;
  }
  return null;
}

export function sessionCookie(token: string, expiresAt: Date, secure = true): string {
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (secure) attributes.push("Secure");
  return attributes.join("; ");
}

export async function createSession(
  db: Database,
  userId: string,
  secret: string,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
  await db.insert(sessions).values({
    id: sessionIdFromToken(token, secret),
    userId,
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
  });
  return { token, expiresAt };
}

/** Clears the session cookie in the browser (sign out). */
export function clearedSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;
}

/** The session of the request's cookie, or null when it is missing, revoked, expired or idle. */
export async function readSession(
  request: Request,
  db: Database,
  secret: string,
  now: Date = new Date(),
): Promise<Session | null> {
  const token = readCookie(request, SESSION_COOKIE);
  return token ? readSessionToken(token, db, secret, now) : null;
}

/** The session of a cookie token (server components read the cookie through next/headers). */
export async function readSessionToken(
  token: string,
  db: Database,
  secret: string,
  now: Date = new Date(),
): Promise<Session | null> {
  if (token.length === 0 || token.length > 128) return null;
  const id = sessionIdFromToken(token, secret);
  const [row] = await db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      lastSeenAt: sessions.lastSeenAt,
      wallet: users.wallet,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  const idleFor = now.getTime() - row.lastSeenAt.getTime();
  if (idleFor > SESSION_IDLE_MS) return null;
  if (idleFor > LAST_SEEN_REFRESH_MS) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, id));
  }
  return { id: row.id, userId: row.userId, wallet: row.wallet };
}
