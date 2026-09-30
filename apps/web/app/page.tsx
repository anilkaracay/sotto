// The landing route (F-17, step 3.1; 09 section 6): the public page from design/sotto-landing.html.
import type { Metadata } from "next";
import { Landing } from "./_landing/landing.tsx";

export const metadata: Metadata = {
  title: "Sotto: confidential business payments on Solana",
  description:
    "The business account for companies that pay in stablecoins. Every payment settles on Solana. Only the people you hand a key to can read the numbers. Beta on Solana devnet.",
};

export default function HomePage() {
  return (
    <main className="theme-landing">
      <Landing />
    </main>
  );
}
