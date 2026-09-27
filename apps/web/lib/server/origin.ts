// CSRF (08 section 6): SameSite=Lax session cookie plus an Origin check on every non GET request. The
// Origin must be the request's own origin or NEXT_PUBLIC_APP_URL; a missing Origin is refused.
import { appOrigin } from "./config.ts";
import { apiErrors } from "./errors.ts";

export const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

export function assertSameOrigin(request: Request): void {
  if (SAFE_METHODS.has(request.method)) return;
  const origin = request.headers.get("origin");
  if (!origin) throw apiErrors.forbiddenOrigin();
  const allowed = new Set([new URL(request.url).origin]);
  const configured = appOrigin();
  if (configured) allowed.add(configured);
  if (!allowed.has(origin)) throw apiErrors.forbiddenOrigin();
}
