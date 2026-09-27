// Shared E2E steps: the injected test wallet (test-wallet.js) and sign in through the sign in screen.
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

export const TEST_WALLET = fileURLToPath(new URL("./test-wallet.js", import.meta.url));

/** Signs in with the injected test wallet and returns its address. */
export async function signIn(page: Page): Promise<string> {
  await page.addInitScript({ path: TEST_WALLET });
  await page.goto("/app/sign-in");
  const option = page.getByTestId("wallet-option").filter({ hasText: "Sotto Test Wallet" });
  await option.getByRole("button", { name: "Connect" }).click();
  await expect(option).toContainText("Connected");
  const wallet = await page.evaluate(
    () =>
      (window as unknown as { __sottoTestWallet: { address: string } }).__sottoTestWallet.address,
  );
  await option.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app\/onboarding$/);
  return wallet;
}
