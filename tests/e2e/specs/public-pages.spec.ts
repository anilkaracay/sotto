// The public pages beside the landing on screens from 1440 down to a phone (step 4.4, founder
// 2026-10-04): /trust and the recovery guide at 1440, 1280, 430 and 390, each without a horizontal
// scroll or a console problem, and compared with its approved baseline.
// The proof page /v/ keeps its baselines in the localnet suite (screens-verify-page.spec.ts), since
// it reads a record from the chain.
import { expect, test } from "@playwright/test";
import { expectVisual } from "../visual.ts";

const PAGES = [
  {
    name: "trust",
    path: "/trust",
    heading: "What Sotto can do with your money, and what it cannot.",
  },
  {
    name: "recovery",
    path: "/app/recovery",
    heading: "Reach your confidential balances without Sotto",
  },
] as const;

for (const page of PAGES) {
  for (const width of [1440, 1280, 430, 390]) {
    test(`${page.name} fits ${width} pixels and matches its approved screen`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const tab = await context.newPage();
      const problems: string[] = [];
      tab.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") {
          problems.push(message.text());
        }
      });
      const at = new Date("2026-10-01T09:00:00.000Z");
      await tab.clock.install({ time: at });
      await tab.clock.pauseAt(at);
      await tab.goto(page.path);
      await expect(tab.getByRole("heading", { level: 1 })).toHaveText(page.heading);
      await expect(tab).toHaveTitle("Sotto · Selective privacy for onchain finance");
      await tab.evaluate(() => document.fonts.ready);
      expect(await tab.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await expectVisual(tab, `${page.name}-${width}`);
      expect(problems).toEqual([]);
      await context.close();
    });
  }
}
