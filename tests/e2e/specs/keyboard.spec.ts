// Keyboard navigation and visible focus (step 3.10, docs/09-FRONTEND.md section 7): on the landing,
// the trust page, sign in, the recovery guide and a signed in wallet's onboarding, Tab moves through
// every visible control of the page (the focus comes back around) and every element that takes the focus shows it, with an outline or a ring.
// The pages of an organization are covered by the axe scans of the localnet specs and the privacy
// screen's keyboard test (step 2.9).
import { expect, test, type Page } from "@playwright/test";
import { addTestWallet, signIn } from "../helpers.ts";

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Presses Tab until the focus comes back to an element it already reached, marking each one, and
 * returns the visible tabbable elements it never reached and the reached ones without a visible focus.
 */
async function tabThrough(
  page: Page,
): Promise<{ reached: number; missed: string[]; unseen: string[] }> {
  const unseen: string[] = [];
  let reached = 0;
  for (let i = 0; i < 300; i++) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      if (element.dataset.tabbed) return "again";
      element.dataset.tabbed = "1";
      const style = getComputedStyle(element);
      const outlined = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
      const ringed = style.boxShadow !== "none";
      const box = element.getBoundingClientRect();
      const label = `${element.tagName.toLowerCase()} ${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40)}`;
      return { label, shown: (outlined || ringed) && box.width > 0 && box.height > 0 };
    });
    if (focus === null) continue;
    if (focus === "again") break;
    reached++;
    if (!focus.shown) unseen.push(focus.label);
  }
  const missed = await page.evaluate((selector) => {
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => !element.dataset.tabbed && element.checkVisibility())
      .map(
        (element) =>
          `${element.tagName.toLowerCase()} ${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40)}`,
      );
  }, TABBABLE);
  return { reached, missed, unseen };
}

for (const [name, path] of [
  ["the landing", "/"],
  ["the trust page", "/trust"],
  ["sign in", "/app/sign-in"],
  ["the recovery guide", "/app/recovery"],
] as const) {
  test(`${name} can be used with the keyboard, its focus always visible`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await addTestWallet(page);
    await page.goto(path);
    await page.evaluate(() => document.fonts.ready);
    const { reached, missed, unseen } = await tabThrough(page);
    expect(reached, `focus stops on ${name}`).toBeGreaterThan(0);
    expect(missed, `elements Tab never reached on ${name}`).toEqual([]);
    expect(unseen, `elements without a visible focus on ${name}`).toEqual([]);
  });
}

test("a signed in page can be used with the keyboard, its focus always visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  const { reached, missed, unseen } = await tabThrough(page);
  expect(reached, "focus stops on onboarding").toBeGreaterThan(0);
  expect(missed, "elements Tab never reached on onboarding").toEqual([]);
  expect(unseen, "elements without a visible focus on onboarding").toEqual([]);
});
