// Visual baselines (step 3.8, X-46; docs/11-TESTING.md sections 1 and 6): a screen that the founder
// approved is compared with its baseline, taken from our own build, with at most 0.5 percent of its
// pixels different and its dynamic regions masked: addresses, keys, signatures and links (the mono
// face and the link fields), dates, times, slots and relative times, month names (the charts shift
// with the calendar), and the header's avatar of the signed in wallet. Animations are stopped by
// Playwright before the shot. Compared only when SOTTO_VISUAL is 1 (scripts/ci-local.sh sets it):
// the baselines are taken on the macOS machine that runs the local CI (D-25), and another system's
// fonts would differ everywhere. A baseline changes only with the founder's approval:
// `SOTTO_VISUAL=1 pnpm --filter @sotto/e2e e2e --update-snapshots` (and e2e:localnet).
import { expect, type Locator, type Page } from "@playwright/test";

export const VISUAL = process.env.SOTTO_VISUAL === "1";

const MONTHS = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
const MONTHS_LONG =
  "January|February|March|April|May|June|July|August|September|October|November|December";

/** The regions whose content changes from run to run, masked in every comparison. */
export function dynamicRegions(page: Page): Locator[] {
  return [
    page.locator(".mono"),
    page.locator('input[readonly], textarea[readonly], [data-testid$="invite-link"]'),
    page.getByText(new RegExp(`\\b\\d{1,2} (${MONTHS}) \\d{4}\\b`)),
    page.getByText(new RegExp(`\\b(${MONTHS_LONG}) \\d{4}\\b`)),
    page.getByText(new RegExp(`^(${MONTHS})$`)),
    page.getByText(/\b\d{1,2}:\d{2} UTC\b/),
    page.getByText(/\bslot \d+/i),
    page.getByText(/\b(Just now|Today|Yesterday|\d+ (minute|minutes|hour|hours|days) ago)\b/),
    page.getByText(/[1-9A-HJ-NP-Za-km-z]{2,4}…[1-9A-HJ-NP-Za-km-z]{2,4}/),
    page.getByRole("button", { name: "Account and organizations" }),
    page.locator('[class*="logAvatar"]'),
  ];
}

/** Compares the page with its baseline `name`, when visual checks are on. */
export async function expectVisual(page: Page, name: string): Promise<void> {
  if (!VISUAL) return;
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    mask: dynamicRegions(page),
    maxDiffPixelRatio: 0.005,
    // Playwright's default of 0.2 let a background change from #eef3fe to #f3e8ff pass (step 3.8):
    // a pixel counts as different from a color distance of 0.02.
    threshold: 0.02,
  });
}
