// The session of the current request for server components (the cookie through next/headers).
import { cookies } from "next/headers";
import { sessionSecret } from "./config.ts";
import { getDb } from "./db.ts";
import { readSessionToken, SESSION_COOKIE, type Session } from "./session.ts";

export async function currentSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return readSessionToken(token, getDb(), sessionSecret());
}
