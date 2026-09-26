import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@sotto/ui/theme-landing.css";
import "@sotto/ui/theme-app.css";

export const metadata: Metadata = {
  title: "Sotto",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
