// API error format (08 section 3): { "error": { "code": "...", "message": "..." } } with the HTTP status.
// The message is also the HTTP reason phrase, because @solana/kit reports only the status text of a
// failed response (the /api/rpc client).
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: Readonly<Record<string, string>>;

  constructor(status: number, code: string, message: string, headers: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export const apiErrors = {
  invalidRequest: (message: string) => new ApiError(400, "invalid_request", message),
  unauthenticated: () => new ApiError(401, "unauthenticated", "Sign in to continue"),
  forbidden: () => new ApiError(403, "forbidden", "You do not have access to this resource"),
  forbiddenOrigin: () => new ApiError(403, "forbidden_origin", "Request origin not allowed"),
  payloadTooLarge: (maxBytes: number) =>
    new ApiError(413, "payload_too_large", `Request body is larger than ${maxBytes} bytes`),
  unsupportedMediaType: () =>
    new ApiError(415, "unsupported_media_type", "Content-Type must be application/json"),
  rateLimited: (retryAfterSeconds: number) =>
    new ApiError(429, "rate_limited", "Too many requests, retry later", {
      "retry-after": String(retryAfterSeconds),
    }),
  internal: () => new ApiError(500, "internal_error", "Internal error"),
  misconfigured: () => new ApiError(500, "server_misconfigured", "Server configuration error"),
};

export function errorResponse(error: ApiError, requestId: string): Response {
  return Response.json(
    { error: { code: error.code, message: error.message } },
    {
      status: error.status,
      statusText: error.message,
      headers: { "x-request-id": requestId, ...error.headers },
    },
  );
}
