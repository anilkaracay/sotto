// The landing in the browser (F-17, AC-17.1; step 3.1): the production build serves `/` from
// design/sotto-landing.html with the copy corrections of 13, without a console error or warning, at
// 1440 and at 390 without a horizontal scroll; Sign in opens the app. Since step 3.2 (AC-17.2) the
// request access form stores a request with the visitor's consent and says thanks.
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
  // Sign in opens the app, which sends a visitor without a session to its sign in screen.
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

test("AC-17.2 stores a request with the visitor's consent and says thanks", async ({ page }) => {
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const form = page.getByTestId("request-access");
  await form.scrollIntoViewIfNeeded();
  await form.getByLabel("Work email", { exact: true }).fill(`landing-${Date.now()}@example.com`);
  await form.getByLabel("Company", { exact: true }).fill("Example Ltd");
  // The consent box takes the pointer where the page first shows it.
  expect(
    await form.getByRole("checkbox").evaluate((box) => {
      const r = box.getBoundingClientRect();
      return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === box;
    }),
  ).toBe(true);
  // Without the consent box, nothing is sent.
  await form.getByRole("button", { name: "Request access" }).click();
  await expect(page.getByTestId("request-access-problem")).toHaveText(
    "Tick the box to agree that Sotto stores your details.",
  );
  // The consent box takes the pointer: nothing, such as the footer's watermark, lies over it.
  const covered = await form.getByRole("checkbox").evaluate((box) => {
    const r = box.getBoundingClientRect();
    return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) !== box;
  });
  expect(covered).toBe(false);
  await form.getByRole("checkbox").check();
  const sent = page.waitForResponse((response) => response.url().endsWith("/api/waitlist"));
  await form.getByRole("button", { name: "Request access" }).click();
  expect((await sent).status()).toBe(201);
  await expect(page.getByTestId("request-access-done")).toHaveText("Thanks, we will be in touch");
  expect(problems).toEqual([]);
});
