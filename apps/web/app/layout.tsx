import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import type { ReactNode } from "react";
import "@sotto/ui/theme-landing.css";
import "@sotto/ui/theme-app.css";
import { siteMetadata } from "../lib/site-metadata.ts";

// Geist and Geist Mono through next/font (09 section 2); the themes read these variables.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

// The brand kit's icons, the manifest and the link preview of every public page (step 4.2.1).
export const metadata: Metadata = siteMetadata(process.env.NEXT_PUBLIC_APP_URL);

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
