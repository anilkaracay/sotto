// The app origin that sign in messages name (D-15, 14 section 2), decided at build time by
// next.config.ts. An explicit NEXT_PUBLIC_APP_URL always wins. Only Vercel preview deployments
// (VERCEL_TARGET_ENV "preview") may derive it from VERCEL_URL, which the platform sets; production,
// devnet and any custom environment must set it explicitly, or the build fails. Requests never decide it.

type Env = Readonly<Record<string, string | undefined>>;

const HOSTNAME = /^[a-z0-9.-]+$/i;

export function buildAppUrl(env: Env): string | undefined {
  const explicit = env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) {
    try {
      return new URL(explicit).origin;
    } catch {
      throw new Error("NEXT_PUBLIC_APP_URL is not a valid URL");
    }
  }
  if (env.VERCEL !== "1") return undefined;
  const deployment = env.VERCEL_URL?.trim();
  if (env.VERCEL_TARGET_ENV === "preview" && deployment && HOSTNAME.test(deployment)) {
    return `https://${deployment}`;
  }
  throw new Error(
    `NEXT_PUBLIC_APP_URL must be set for the Vercel ${env.VERCEL_TARGET_ENV ?? "unknown"} environment; only preview deployments derive it from VERCEL_URL`,
  );
}
