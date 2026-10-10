// The walkthrough page in the browser (step 4.8, D-35): public, every step with its picture loaded,
// readable at 1440 and 390 without sideways scrolling, and accessible. The demo banner's link to it
// is in demo.spec.ts. The labels it names are checked against the screens' sources in
// apps/web/test/walkthrough.test.tsx; the checklist's link is in onboarding.spec.ts.
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { expectAccessible } from "../a11y.ts";

const SHOTS = fileURLToPath(new URL("../../../.demo-shots/walkthrough/", import.meta.url));

const STEPS = [
  "Switch your wallet to devnet",
  "Quick start: sign in",
  "Get ready to pay",
  "Pay Atlas Freight",
  "Check on the explorer that the amount is hidden",
  "Prove a balance without showing it",
];

test("the walkthrough: six steps with their pictures, at 1440 and 390, with no session", async ({
  page,
}) => {
  const response = await page.goto("/app/walkthrough");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/app\/walkthrough$/);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Walkthrough: from sign in to a first confidential payment",
    }),
  ).toBeVisible();
  const steps = page.getByTestId("walkthrough-step");
  await expect(steps).toHaveCount(STEPS.length);
  for (const [index, title] of STEPS.entries()) {
    await expect(steps.nth(index).getByRole("heading", { level: 2 })).toContainText(title);
  }
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    // Every picture loads, and none makes the page wider than the screen.
    const pictures = page.locator("figure img");
    const count = await pictures.count();
    expect(count).toBeGreaterThanOrEqual(STEPS.length);
    for (let index = 0; index < count; index += 1) {
      const picture = pictures.nth(index);
      await picture.scrollIntoViewIfNeeded();
      await expect
        .poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth))
        .toBeGreaterThan(0);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    // A picture of the whole page at this width, for the founder.
    await page.evaluate(() => window.scrollTo(0, 0));
    const path = test.info().outputPath(`walkthrough-${width}.png`);
    await page.screenshot({ path, fullPage: true });
    await mkdir(SHOTS, { recursive: true });
    await copyFile(path, `${SHOTS}walkthrough-${width}.png`);
  }
  await expectAccessible(page, "walkthrough");
  expect(await page.context().cookies()).toEqual([]);
});

test("the walkthrough leads back to the app", async ({ page }) => {
  await page.goto("/app/walkthrough");
  await page.getByRole("link", { name: "Open Sotto" }).click();
  await expect(page).toHaveURL(/\/app(\/sign-in)?$/);
});
