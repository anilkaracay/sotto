import type { NextConfig } from "next";

// Dev only routes (the Gate G2 wallet lab, app/dev/wallet-lab) are named page.dev.tsx and route.dev.ts.
// Those extensions are page extensions only under next dev: the Next.js CLI sets NODE_ENV to
// "development" for next dev and "production" for next build before it loads this file. A production
// build therefore does not contain the dev routes at all (scripts/checks/build-output.py checks it).
// The dev extensions come first so they match before .tsx and .ts.
const DEFAULT_EXTENSIONS = ["tsx", "ts", "jsx", "js"];
const DEV_ONLY_EXTENSIONS = ["dev.tsx", "dev.ts"];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@sotto/ui"],
  pageExtensions:
    process.env.NODE_ENV === "development"
      ? [...DEV_ONLY_EXTENSIONS, ...DEFAULT_EXTENSIONS]
      : DEFAULT_EXTENSIONS,
};

export default nextConfig;
