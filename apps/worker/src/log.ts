// Structured JSON log lines for the worker (08 section 6). Strings pass through redact(), so
// connection strings and API keys never reach a log, and failed queries are logged without their
// parameters; no amount or key material is ever logged.
import { redact } from "./redact.ts";

export type Logger = (
  event: string,
  fields?: Record<string, unknown>,
  level?: "info" | "warn" | "error",
) => void;

// A failed Drizzle query names its parameters in the message ("Failed query: ...\nparams: ..."):
// only the statement is kept, and the database error comes from the cause without its detail.
function cleanError(error: Error): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: error.name,
    message: redact(error.message.split("\nparams:")[0] ?? ""),
  };
  const cause: unknown = error.cause;
  if (cause instanceof Error) {
    const { code, constraint_name: constraint } = cause as {
      code?: unknown;
      constraint_name?: unknown;
    };
    out.cause = {
      name: cause.name,
      message: redact(cause.message),
      ...(typeof code === "string" ? { code } : {}),
      ...(typeof constraint === "string" ? { constraint } : {}),
    };
  }
  return out;
}

function clean(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) return cleanError(value);
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  }
  return value;
}

export const log: Logger = (event, fields = {}, level = "info") => {
  const line = JSON.stringify({
    ...(clean(fields) as object),
    time: new Date().toISOString(),
    level,
    event,
  });
  if (level === "error") console.error(line);
  else console.log(line);
};
