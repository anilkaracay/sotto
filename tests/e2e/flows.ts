// Browser steps the scenarios share (the acceptance scenario, step 2.10, and the demo seed, step 4.3):
// connect the injected test wallet, unlock the keys, move through the app's navigation and sign in
// from an invite.
import { expect, type Page } from "@playwright/test";

/** Connects the wallet on a page with the wallet card, if this tab has not yet. */
export async function connectWallet(page: Page) {
  const connect = page.getByRole("button", { name: "Connect" }).first();
  const signing = page.getByTestId("keys-wallet");
  await expect(connect.or(signing)).toBeVisible();
  if (await connect.isVisible()) await connect.click();
  await expect(signing).toBeVisible();
}

/** One Unlock click opens both keys; they stay open across the tab's client side navigation. */
export async function unlock(page: Page) {
  await connectWallet(page);
  await page.getByRole("button", { name: "Unlock with your wallet" }).click();
  await expect(page.getByTestId("viewing-unlocked")).toHaveText("Unlocked");
}

export async function go(page: Page, name: string) {
  await page.getByRole("navigation").getByRole("link", { name, exact: true }).click();
}

/** The invite page's sign in with the invited wallet, back on the invite. */
export async function signInFromInvite(page: Page) {
  await page.getByTestId("invite-sign-in").click();
  const option = page.getByTestId("wallet-option").filter({ hasText: "Sotto Test Wallet" });
  await option.getByRole("button", { name: "Connect" }).click();
  await option.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app\/invite\/[A-Za-z0-9_-]{43}$/);
}

/** A CSV value as RFC 4180 writes it: in double quotes, with each quote doubled, when it needs them. */
export const csvValue = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
