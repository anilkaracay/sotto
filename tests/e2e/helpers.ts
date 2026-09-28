// Shared E2E steps: the injected test wallet (test-wallet.js) and sign in through the sign in screen.
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";

export const TEST_WALLET = fileURLToPath(new URL("./test-wallet.js", import.meta.url));

/** Adds the test wallet to every page load, optionally with a fixed keypair (see fixtures.ts). */
/**
 * A client address for a browser context (TEST-NET-2, RFC 5737). The API's per IP limits key on the
 * first x-forwarded-for entry (08 section 6); without one every local request shares a single bucket,
 * so the specs, whose people sign in from one machine, give each context its own address, as
 * separate users would have (step 1.9).
 */
export function clientAddress(): { "x-forwarded-for": string } {
  return { "x-forwarded-for": `198.51.100.${1 + Math.floor(Math.random() * 254)}` };
}

export async function addTestWallet(page: Page, keypair?: number[]): Promise<void> {
  if (keypair) {
    await page.addInitScript({
      content: `window.__sottoTestWalletKeypair = ${JSON.stringify(keypair)};`,
    });
  }
  await page.addInitScript({ path: TEST_WALLET });
}

/** An owner's org pages: the overview, where /app sends the owner of an active org (step 1.10). */
export const OVERVIEW_URL = /\/app\/([0-9a-f-]{36})\/overview$/;
export const SETUP_URL = /\/app\/([0-9a-f-]{36})\/setup$/;

/**
 * Signs in with the injected test wallet and returns its address. Sign in opens /app, which sends a
 * user without an active org to onboarding, the owner of an active org to its overview and a
 * recipient to the pay page.
 */
export async function signIn(
  page: Page,
  keypair?: number[],
  landing: RegExp = /\/app\/onboarding$/,
): Promise<string> {
  await addTestWallet(page, keypair);
  await page.goto("/app/sign-in");
  const option = page.getByTestId("wallet-option").filter({ hasText: "Sotto Test Wallet" });
  await option.getByRole("button", { name: "Connect" }).click();
  await expect(option).toContainText("Connected");
  const wallet = await page.evaluate(
    () =>
      (window as unknown as { __sottoTestWallet: { address: string } }).__sottoTestWallet.address,
  );
  await option.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(landing);
  return wallet;
}

/** From an owner's org page to Account setup through the top nav. */
export async function openSetup(page: Page): Promise<void> {
  await page.getByRole("navigation").getByRole("link", { name: "Account setup" }).click();
  await expect(page).toHaveURL(SETUP_URL);
}
