// Server configuration (14 section 2), read from process.env on each use: Next.js env loading locally
// (.env.local), only the platform's variables when hosted. Errors name the variable, never its value.
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type Env = Readonly<Record<string, string | undefined>>;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigError(`${name} is not set`);
  return value;
}

function url(name: string, value: string): URL {
  if (/\s/.test(value) || value.split("://").length !== 2) {
    throw new ConfigError(`${name} must be a single URL`);
  }
  try {
    return new URL(value);
  } catch {
    throw new ConfigError(`${name} is not a valid URL`);
  }
}

export function databaseUrl(env: Env = process.env): string {
  const value = required(env, "DATABASE_URL");
  const parsed = url("DATABASE_URL", value);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new ConfigError("DATABASE_URL must be a postgres URL");
  }
  return value;
}

/** RPC_URL: one https URL, plain http only for a local validator. Used by /api/rpc only. */
export function rpcUrl(env: Env = process.env): string {
  const value = required(env, "RPC_URL");
  const parsed = url("RPC_URL", value);
  if (
    parsed.protocol !== "https:" &&
    !(parsed.protocol === "http:" && LOCAL_HOSTS.has(parsed.hostname))
  ) {
    throw new ConfigError("RPC_URL must use https (http only for a local validator)");
  }
  return value;
}

/** SESSION_SECRET keys the session ID and rate limit HMACs; at least 32 characters. */
export function sessionSecret(env: Env = process.env): string {
  const value = required(env, "SESSION_SECRET");
  if (value.length < 32) throw new ConfigError("SESSION_SECRET must be at least 32 characters");
  return value;
}

/**
 * The build time app URL: next.config.ts sets it from an explicit NEXT_PUBLIC_APP_URL or, on Vercel
 * preview deployments only, from VERCEL_URL (lib/app-url.ts). Next.js inlines this literal at build time.
 */
const BUILD_APP_URL: string | undefined = process.env.NEXT_PUBLIC_APP_URL;

/**
 * Origin of the app: NEXT_PUBLIC_APP_URL from the runtime environment, else the build time value, or
 * null when neither exists. Never derived from a request (D-15).
 */
export function appOrigin(
  env: Env = process.env,
  built: string | undefined = BUILD_APP_URL,
): string | null {
  const value = env.NEXT_PUBLIC_APP_URL?.trim() || built?.trim();
  if (!value) return null;
  return url("NEXT_PUBLIC_APP_URL", value).origin;
}

/** The app origin sign in messages name (D-15). Required: never derived from the request's Host. */
export function appOriginRequired(env: Env = process.env): string {
  const origin = appOrigin(env);
  if (!origin) throw new ConfigError("NEXT_PUBLIC_APP_URL is not set");
  return origin;
}
