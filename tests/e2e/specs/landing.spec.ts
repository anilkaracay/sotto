// The landing in the browser (F-17, AC-17.1; step 3.1): the production build serves `/` from
// design/sotto-landing.html with the copy corrections of 13, without a console error or warning, at
// 1440 and at 390 without a horizontal scroll; Sign in opens the app's sign in screen.
import { expect, test, type Page } from "@playwright/test";

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      problems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  return problems;
}

test("AC-17.1 serves the landing with its corrected copy and no console error", async ({
  page,
}) => {
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Private books.");
  await expect(page.getByText("Beta on Solana devnet").first()).toBeVisible();
  await expect(page.getByTestId("landing-facts")).toContainText(
    "A confidential payment is one Solana transaction with a version 1 wallet.",
  );
  await expect(page.getByText("Built for Colosseum's Crypto World's Fair")).toBeVisible();
  const body = await page.locator("body").innerText();
  expect(body).not.toMatch(/\b(True|False)\b|one transaction|open source|mainnet-beta/i);
  // The hero's views change on a timer; the page keeps running without a problem.
  await page.waitForTimeout(4500);
  expect(problems).toEqual([]);
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app\/sign-in$/);
});

test("AC-17.1 fits a 390 pixel phone without a horizontal scroll", async ({ page }) => {
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  expect(problems).toEqual([]);
});
