// Plan move M3 as amended: the first Playwright happy path, sign in and connect wallet (F-01).
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const TEST_WALLET = fileURLToPath(new URL("../test-wallet.js", import.meta.url));

test("sign in and connect wallet", async ({ page }) => {
  await page.addInitScript({ path: TEST_WALLET });

  await page.goto("/app");
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  await expect(page.getByRole("heading", { name: "Sign in to Sotto" })).toBeVisible();
  await expect(page.getByTestId("network-label")).toHaveText("Devnet");

  const option = page.getByTestId("wallet-option").filter({ hasText: "Sotto Test Wallet" });
  await option.getByRole("button", { name: "Connect" }).click();
  await expect(option).toContainText("Connected");
  const wallet = await page.evaluate(
    () =>
      (window as unknown as { __sottoTestWallet: { address: string } }).__sottoTestWallet.address,
  );

  await option.getByRole("button", { name: "Sign in" }).click();
  // Without an organization, /app sends the user to onboarding (F-02).
  await expect(page).toHaveURL(/\/app\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Your organization" })).toBeVisible();
  await expect(page.getByTestId("network-label")).toHaveText("Devnet");

  const me = await page.request.get("/api/me");
  expect(me.status()).toBe(200);
  expect(((await me.json()) as { user: { wallet: string } }).user.wallet).toBe(wallet);
  // The session cookie is httpOnly: page scripts cannot read it (D-15).
  expect(await page.evaluate(() => document.cookie)).not.toContain("sotto_session");

  await page.getByRole("button", { name: "Account and organizations" }).click();
  await expect(page.getByTestId("signed-in-wallet")).toHaveText(wallet);
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/app\/sign-in$/);
  expect((await page.request.get("/api/me")).status()).toBe(401);
});
