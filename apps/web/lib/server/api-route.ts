// Route wrapper for /api: request ID, Origin check (CSRF) on non GET requests, session, rate limits,
// the 08 error format and one structured log line per request.
import { randomUUID } from "node:crypto";
import type { Database } from "@sotto/db";
import { ConfigError, sessionSecret } from "./config.ts";
import { getDb } from "./db.ts";
import { ApiError, apiErrors, errorResponse } from "./errors.ts";
import { log } from "./log.ts";
import { assertSameOrigin } from "./origin.ts";
import { clientIp, consumeRateLimit, type RateLimitPolicy } from "./rate-limit.ts";
import { readSession, type Session } from "./session.ts";

export type RouteContext = {
  request: Request;
  requestId: string;
  session: Session | null;
  database: () => Database;
  /** Extra fields for the request log line (redacted like every log field). */
  annotate: (fields: Record<string, unknown>) => void;
  params: Record<string, string | string[] | undefined>;
};

export type RouteOptions = {
  /** "session" refuses requests without a valid session (401). */
  auth: "none" | "optional" | "session";
  rateLimits?: readonly RateLimitPolicy[];
};

type NextRouteContext = { params?: Promise<Record<string, string | string[] | undefined>> };

export function apiRoute(
  options: RouteOptions,
  handler: (context: RouteContext) => Promise<Response>,
): (request: Request, context?: NextRouteContext) => Promise<Response> {
  return async (request, context) => {
    const requestId = randomUUID();
    const started = Date.now();
    const fields: Record<string, unknown> = {};
    let status = 500;
    try {
      assertSameOrigin(request);
      const needsDb = options.auth !== "none" || (options.rateLimits?.length ?? 0) > 0;
      const db = needsDb ? getDb() : null;
      const secret = needsDb ? sessionSecret() : "";
      const session = db && options.auth !== "none" ? await readSession(request, db, secret) : null;
      if (options.auth === "session" && !session) throw apiErrors.unauthenticated();
      if (session) fields.userId = session.userId;
      for (const policy of options.rateLimits ?? []) {
        const subject = policy.by === "session" ? session?.id : clientIp(request);
        if (!subject || !db) throw apiErrors.unauthenticated();
        const result = await consumeRateLimit(db, policy, subject, secret);
        if (!result.allowed) throw apiErrors.rateLimited(result.retryAfterSeconds);
      }
      const response = await handler({
        request,
        requestId,
        session,
        database: () => db ?? getDb(),
        annotate: (extra) => Object.assign(fields, extra),
        params: (await context?.params) ?? {},
      });
      response.headers.set("x-request-id", requestId);
      status = response.status;
      return response;
    } catch (error) {
      let apiError: ApiError;
      if (error instanceof ApiError) {
        apiError = error;
      } else if (error instanceof ConfigError) {
        log("error", "api_config_error", { requestId, error });
        apiError = apiErrors.misconfigured();
      } else {
        log("error", "api_unhandled_error", { requestId, error });
        apiError = apiErrors.internal();
      }
      status = apiError.status;
      return errorResponse(apiError, requestId);
    } finally {
      log(status >= 500 ? "error" : "info", "api_request", {
        requestId,
        method: request.method,
        path: new URL(request.url).pathname,
        status,
        durationMs: Date.now() - started,
        ...fields,
      });
    }
  };
}
