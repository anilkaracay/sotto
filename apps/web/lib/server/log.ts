// Structured JSON logging (08 section 6) with the redaction list: fields named like keys, secrets,
// signatures, ciphertexts, blobs, session or auth material, or amounts are replaced, and connection
// strings and API keys are removed from every string. The error reporting service uses redact() too.
const REDACTED = "[redacted]";

export const REDACTED_FIELD =
  /key|secret|signature|ciphertext|blob|seed|mnemonic|password|passphrase|token|cookie|authorization|session|ikm|private|amount|salary|balance|budget|gross|tax/i;

const SECRET_ENV = [
  "RPC_URL",
  "DATABASE_URL",
  "SESSION_SECRET",
  "SCREENING_API_KEY",
  "RESEND_API_KEY",
];

export function scrub(text: string): string {
  let out = text;
  for (const name of SECRET_ENV) {
    const value = process.env[name];
    if (value && value.length >= 8) out = out.split(value).join(REDACTED);
  }
  return out
    .replace(/postgres(?:ql)?:\/\/[^\s"'<>]+/gi, "<database-url>")
    .replace(/https?:\/\/[^\s"'<>]*helius-rpc\.com[^\s"'<>]*/gi, "<rpc-url>")
    .replace(/(api[-_]?key|apikey|token|secret)=[^\s"'&<>]*/gi, "$1=" + REDACTED);
}

// A failed Drizzle query names its parameters in the message ("Failed query: ...\nparams: ..."),
// and those can be what a user typed. Only the statement is kept; the database error comes from the
// cause, without its detail (which can repeat the row).
function redactError(error: Error): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: error.name,
    message: scrub(error.message.split("\nparams:")[0] ?? ""),
  };
  const cause: unknown = error.cause;
  if (cause instanceof Error) {
    const { code, constraint_name: constraint } = cause as {
      code?: unknown;
      constraint_name?: unknown;
    };
    out.cause = {
      name: cause.name,
      message: scrub(cause.message),
      ...(typeof code === "string" ? { code } : {}),
      ...(typeof constraint === "string" ? { constraint } : {}),
    };
  }
  return out;
}

export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrub(value);
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (depth >= 6) return REDACTED;
  if (value instanceof Error) return redactError(value);
  if (value instanceof Uint8Array) return REDACTED;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = REDACTED_FIELD.test(key) ? REDACTED : redact(item, depth + 1);
  }
  return out;
}

export type LogLevel = "info" | "warn" | "error";

export function log(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  // The fixed keys come last, so a field can never overwrite them.
  const line = JSON.stringify({
    ...(redact(fields) as object),
    time: new Date().toISOString(),
    level,
    event,
  });
  if (level === "error") console.error(line);
  else console.log(line);
}
