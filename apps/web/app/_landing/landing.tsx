"use client";

// The landing (F-17, AC-17.1; step 3.1): design/sotto-landing.html (landing v8) rebuilt as section
// components on the landing theme (packages/ui/theme-landing.css), with the copy corrections of
// 13-COPY-CORRECTIONS.md (L1 to L32 and the devnet beta rule) and the founder's rules of 2026-09-30.
// Illustrations use sample data and say so; nothing here reads Sotto or the chain.
import { Compare } from "./sections/compare.tsx";
import { Developers } from "./sections/developers.tsx";
import { Facts } from "./sections/facts.tsx";
import { Faq } from "./sections/faq.tsx";
import { Footer } from "./sections/footer.tsx";
import { Hero } from "./sections/hero.tsx";
import { ProofDemo } from "./sections/proof.tsx";
import { QuickNav } from "./sections/quick-nav.tsx";
import { Steps } from "./sections/steps.tsx";
import { Story } from "./sections/story.tsx";
import { Trust } from "./sections/trust.tsx";
import { UseCases } from "./sections/uses.tsx";
import { Views } from "./sections/views.tsx";
import { useLanding } from "./use-landing.ts";

export function Landing() {
  const v = useLanding();
  return (
    <div className="p5">
      <QuickNav />
      <Hero v={v} />
      <Story />
      <Facts />
      <Compare v={v} />
      <Views v={v} />
      <UseCases />
      <ProofDemo v={v} />
      <Steps v={v} />
      <Trust v={v} />
      <Developers v={v} />
      <Faq v={v} />
      <Footer v={v} />
    </div>
  );
}
