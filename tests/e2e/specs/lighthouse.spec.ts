// Lighthouse (step 3.10, docs/09-FRONTEND.md section 7): performance 90 or more on the landing and
// accessibility 95 or more on every page the node job can show, with Lighthouse's desktop preset
// (the app is desktop first, 09 section 2) against the production build: the landing, the trust
// page, sign in, the recovery guide, and a signed in wallet's onboarding. The pages of an organization
// need a chain and are scanned with axe in the localnet specs (tests/e2e/a11y.ts), which Lighthouse's
// accessibility audits run too. Lighthouse opens its pages in the browser this spec launched, so the
// signed in session's cookie is used; the scores are printed and attached to the test.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import lighthouse from "lighthouse";
import desktopConfig from "lighthouse/core/config/desktop-config.js";
import { signIn } from "../helpers.ts";

const PORT = 9333;

type Target = { name: string; path: string; performance?: number };

const TARGETS: Target[] = [
  { name: "landing", path: "/", performance: 0.9 },
  { name: "trust", path: "/trust" },
  { name: "sign in", path: "/app/sign-in" },
  { name: "recovery guide", path: "/app/recovery" },
];

test("Lighthouse: performance 90 on the landing, accessibility 95 on every page", async () => {
  test.setTimeout(300_000);
  const baseURL = test.info().project.use.baseURL as string;
  const profile = mkdtempSync(join(tmpdir(), "sotto-lighthouse-"));
  const context = await chromium.launchPersistentContext(profile, {
    baseURL,
    args: [`--remote-debugging-port=${PORT}`],
  });
  const scores: string[] = [];
  try {
    const run = async (target: Target) => {
      const categories = target.performance ? ["performance", "accessibility"] : ["accessibility"];
      const result = await lighthouse(
        `${baseURL}${target.path}`,
        {
          port: PORT,
          output: "json",
          logLevel: "error",
          onlyCategories: categories,
          disableStorageReset: true,
        },
        desktopConfig,
      );
      const lhr = result?.lhr;
      if (!lhr) throw new Error(`Lighthouse returned no result for ${target.name}`);
      const accessibility = lhr.categories.accessibility?.score ?? 0;
      const performance = lhr.categories.performance?.score ?? null;
      scores.push(
        `${target.name}: accessibility ${Math.round(accessibility * 100)}${
          performance === null ? "" : `, performance ${Math.round(performance * 100)}`
        }`,
      );
      const failing = Object.values(lhr.audits)
        .filter(
          (audit) =>
            audit.score !== null &&
            audit.score < 1 &&
            lhr.categories.accessibility?.auditRefs.some((ref) => ref.id === audit.id),
        )
        .map((audit) => audit.id);
      expect(
        accessibility,
        `${target.name} accessibility (failing audits: ${failing.join(", ")})`,
      ).toBeGreaterThanOrEqual(0.95);
      if (target.performance && performance !== null) {
        expect(performance, `${target.name} performance`).toBeGreaterThanOrEqual(
          target.performance,
        );
      }
    };
    for (const target of TARGETS) await run(target);
    // A signed in wallet's page: onboarding, with the session cookie in this browser.
    const page = context.pages()[0] ?? (await context.newPage());
    await signIn(page);
    await run({ name: "onboarding", path: "/app/onboarding" });
  } finally {
    console.log(`lighthouse scores: ${scores.join("; ")}`);
    await test
      .info()
      .attach("lighthouse scores", { body: scores.join("\n"), contentType: "text/plain" });
    await context.close();
    rmSync(profile, { recursive: true, force: true });
  }
});
