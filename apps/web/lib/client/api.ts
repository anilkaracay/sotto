// JSON calls to the Sotto API from the browser, with the 08 error format turned into ApiCallError.
export class ApiCallError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiCallError";
    this.status = status;
    this.code = code;
  }
}

/** A call that gets no answer within this time is given up (step 4.9): no page waits without end. */
export const API_TIMEOUT_MS = 30_000;

export async function callApi<T>(
  path: string,
  init: { method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown } = { method: "GET" },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method,
      credentials: "same-origin",
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
      ...(init.body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new ApiCallError(0, "timeout", "Sotto did not answer in time. Try again.");
    }
    throw new ApiCallError(
      0,
      "network_error",
      "Sotto could not be reached. Check your connection and try again.",
    );
  }
  if (!response.ok) {
    let code = "request_failed";
    let message = `Request failed (${response.status})`;
    try {
      const error = ((await response.json()) as { error?: { code?: string; message?: string } })
        .error;
      if (error?.code) code = error.code;
      if (error?.message) message = error.message;
    } catch {
      // Keep the generic message.
    }
    throw new ApiCallError(response.status, code, message);
  }
  return (await response.json()) as T;
}

/** The field a 400 invalid_request names ("Invalid request: <field>: <message>"), if any. */
export function invalidField(error: ApiCallError): { field: string; message: string } | null {
  if (error.code !== "invalid_request") return null;
  const match = /^Invalid request: ([A-Za-z]+): (.+)$/.exec(error.message);
  return match?.[1] && match[2] ? { field: match[1], message: match[2] } : null;
}
