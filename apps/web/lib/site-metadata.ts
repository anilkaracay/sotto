// The site's metadata (step 4.2.1): the brand kit's icons, the web manifest and the link preview.
// Every public page (the landing, /trust, the recovery guide, /v/) shares the landing's title and
// description in its preview, with the kit's 1200 x 630 image. The root layout sets it; pages that set
// only a title and a description inherit it (Next.js merges openGraph and twitter from the layout).
import type { Metadata } from "next";

// Step 4.4 (founder, 2026-10-04): "selective privacy" names the category, "confidential" the mechanism
// and the product, never both in one sentence or heading. Every public page but /v/ uses this title.
export const LANDING_TITLE = "Sotto · Selective privacy for onchain finance";
export const LANDING_DESCRIPTION =
  "The confidential business account on Solana. Amounts sealed, each reader sees only their scope, and balances proven without being shown.";

const OG_IMAGE = {
  url: "/sotto-og-1200x630.png",
  width: 1200,
  height: 630,
  alt: "Sotto. Private books. Public chain. The confidential business account for stablecoin payments on Solana.",
};

/** The brand files under apps/web/public that the build output check requires (scripts/checks). */
export const BRAND_FILES = [
  "favicon.ico",
  "favicon.svg",
  "favicon-16.png",
  "favicon-32.png",
  "favicon-48.png",
  "favicon-192.png",
  "favicon-512.png",
  "apple-touch-icon-180.png",
  "site.webmanifest",
  "sotto-og-1200x630.png",
] as const;

export function siteMetadata(appUrl: string | undefined): Metadata {
  return {
    // Absolute link preview URLs; NEXT_PUBLIC_APP_URL is fixed at build time (next.config.ts).
    metadataBase: new URL(appUrl || "http://localhost:3000"),
    title: "Sotto",
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/favicon.svg", type: "image/svg+xml" },
        { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
        { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/favicon-48.png", sizes: "48x48", type: "image/png" },
      ],
      apple: [{ url: "/apple-touch-icon-180.png", sizes: "180x180", type: "image/png" }],
    },
    manifest: "/site.webmanifest",
    openGraph: {
      type: "website",
      siteName: "Sotto",
      title: LANDING_TITLE,
      description: LANDING_DESCRIPTION,
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: LANDING_TITLE,
      description: LANDING_DESCRIPTION,
      images: [OG_IMAGE],
    },
  };
}
