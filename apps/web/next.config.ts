import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";
import { buildAppUrl } from "./lib/app-url.ts";

// Dev only routes (the Gate G2 wallet lab, app/dev/wallet-lab) are named page.dev.tsx and route.dev.ts.
// Those extensions are page extensions only under next dev: the Next.js CLI sets NODE_ENV to
// "development" for next dev and "production" for next build before it loads this file. A production
// build therefore does not contain the dev routes at all (scripts/checks/build-output.py checks it).
// The dev extensions come first so they match before .tsx and .ts.
const DEFAULT_EXTENSIONS = ["tsx", "ts", "jsx", "js"];
const DEV_ONLY_EXTENSIONS = ["dev.tsx", "dev.ts"];

// The app origin sign in messages name, fixed at build time (lib/app-url.ts).
const appUrl = buildAppUrl(process.env);

// The hosted image (D-28) sets SOTTO_STANDALONE=1: a standalone server traced
// from the repository root, so the workspace packages come along (next 16.3.6 docs, output.md). Local
// builds, the E2E server and CI keep next start.
const standalone = process.env.SOTTO_STANDALONE === "1";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(standalone
    ? {
        output: "standalone" as const,
        outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)),
      }
    : {}),
  transpilePackages: ["@sotto/ui"],
  pageExtensions:
    process.env.NODE_ENV === "development"
      ? [...DEV_ONLY_EXTENSIONS, ...DEFAULT_EXTENSIONS]
      : DEFAULT_EXTENSIONS,
  ...(appUrl ? { env: { NEXT_PUBLIC_APP_URL: appUrl } } : {}),
};

export default nextConfig;
