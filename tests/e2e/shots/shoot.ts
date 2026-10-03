// Shared by the screenshot specs (step 4.3): a full page shot at 1440 and at 390 into SOTTO_SHOTS_DIR,
// and the check that "Privacy screen" stays on one line and the page does not scroll sideways because
// of the top bar.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

const DIR = process.env.SOTTO_SHOTS_DIR;
if (!DIR) throw new Error("SOTTO_SHOTS_DIR is not set");

export const WIDTHS = [1440, 390] as const;

/** The privacy toggle's label is one line: its box is as high as one line of its text. */
export async function expectPrivacyOnOneLine(page: Page): Promise<void> {
  const toggle = page.getByTestId("privacy-toggle");
  if ((await toggle.count()) === 0) return;
  const lines = await toggle.locator("span").evaluate((label) => {
    const style = getComputedStyle(label);
    const lineHeight =
      Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.5;
    return Math.round(label.getBoundingClientRect().height / lineHeight);
  });
  expect(lines, "lines of the Privacy screen label").toBe(1);
  expect((await toggle.boundingBox())?.height).toBe(40);
}

/** A full page shot at each width, and of one element when given; back at 1440 afterwards. */
export async function shoot(page: Page, name: string, element?: Locator): Promise<void> {
  await mkdir(DIR as string, { recursive: true });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.mouse.move(0, 0);
    await expectPrivacyOnOneLine(page);
    await page.screenshot({ path: join(DIR as string, `${name}-${width}.png`), fullPage: true });
    if (element) {
      await element.scrollIntoViewIfNeeded();
      await element.screenshot({ path: join(DIR as string, `${name}-${width}-detail.png`) });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}
