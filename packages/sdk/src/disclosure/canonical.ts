// Canonical JSON (07 section 2): object keys sorted, UTF-8, no insignificant whitespace, implemented once
// here. Keys sort by UTF-16 code units (JavaScript's default sort); every key Sotto uses is ASCII, where
// that equals code point order. Only strings, safe integers, booleans, null, arrays and plain objects
// are allowed: a float, a non finite number or an undefined value has no single canonical form, so it
// throws rather than being silently changed.
export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

function encode(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new CanonicalJsonError(`${path} is not a safe integer`);
      }
      return String(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item, index) => encode(item, `${path}[${index}]`)).join(",")}]`;
      }
      const prototype = Object.getPrototypeOf(value) as unknown;
      if (prototype !== Object.prototype && prototype !== null) {
        throw new CanonicalJsonError(`${path} is not a plain object`);
      }
      const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      );
      return `{${entries
        .map(([key, item]) => `${JSON.stringify(key)}:${encode(item, `${path}.${key}`)}`)
        .join(",")}}`;
    }
    default:
      throw new CanonicalJsonError(`${path} has a value JSON cannot hold (${typeof value})`);
  }
}

export function canonicalJson(value: unknown): string {
  return encode(value, "$");
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}
