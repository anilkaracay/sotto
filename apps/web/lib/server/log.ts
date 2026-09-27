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

export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrub(value);
  if (typeof value === "bigint") return value.toString();
  if (value === null || typeof value !== "object") return value;
  if (depth >= 6) return REDACTED;
  if (value instanceof Error) return { name: value.name, message: scrub(value.message) };
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
