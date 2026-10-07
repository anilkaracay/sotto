// The landing route (F-17, step 3.1; 09 section 6): the public page from the approved landing design.
import type { Metadata } from "next";
import { LANDING_DESCRIPTION, LANDING_TITLE } from "../lib/site-metadata.ts";
import { Landing } from "./_landing/landing.tsx";

export const metadata: Metadata = {
  title: LANDING_TITLE,
  description: LANDING_DESCRIPTION,
};

export default function HomePage() {
  return (
    <main className="theme-landing">
      <Landing />
    </main>
  );
}
