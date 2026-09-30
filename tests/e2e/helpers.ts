// Shared E2E steps: the injected test wallet (test-wallet.js) and sign in through the sign in screen.
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import { AMOUNT_TEXT } from "../../apps/web/lib/amount-text.ts";

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
/** Any app page but the sign in screen: where the E2E admin lands, whatever it owns (step 2.12). */
export const ANY_APP_PAGE = /\/app(?!\/sign-in)(\/.*)?$/;

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

/** F-15 (AC-15.1): turns the privacy screen on from the top bar's toggle, unless it is on already. */
export async function privacyScreenOn(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Privacy screen" });
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toContainText("Privacy screen on");
}

/**
 * F-15 (AC-15.1; step 2.9): with the privacy screen on, fails when the page shows currency formatted
 * text outside `Amount`, and checks that one amount is blurred and shows on focus. The page's text is
 * read as the reader sees it (innerText of a copy of the page with every data-amount element taken
 * out, laid out off screen), so hidden elements, scripts and styles do not count.
 */
export async function expectAmountsWrapped(page: Page, where: string): Promise<void> {
  await privacyScreenOn(page);
  const outside = await page.evaluate((source) => {
    const copy = document.body.cloneNode(true) as HTMLElement;
    for (const element of copy.querySelectorAll("script, style, template, noscript")) {
      element.remove();
    }
    for (const element of copy.querySelectorAll("[data-amount]")) element.replaceWith("•");
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.style.cssText = "position:absolute;left:-100000px;top:0;width:1440px;";
    host.append(copy);
    document.documentElement.append(host);
    const text = copy.innerText;
    host.remove();
    return text.match(new RegExp(source, "g")) ?? [];
  }, AMOUNT_TEXT.source);
  expect(outside, `currency formatted text outside Amount on ${where}`).toEqual([]);

  // One amount that takes the focus, in the open drawer if there is one.
  const dialog = page.getByRole("dialog");
  const scope = (await dialog.count()) > 0 ? dialog.last() : page.locator("body");
  const amount = scope.locator('span[data-amount][tabindex="0"]:visible').first();
  if ((await amount.count()) === 0) return;
  const filter = () => amount.evaluate((element) => getComputedStyle(element).filter);
  await expect.poll(filter).toContain("blur(7px)");
  await amount.focus();
  await expect.poll(filter).toBe("none");
  await amount.blur();
}

/**
 * The E2E admin approves one organization by its legal name, on a page signed in as the admin. The
 * localnet specs run in parallel, so other organizations may be waiting for review at the same time;
 * each spec approves only its own (step 2.12).
 */
export async function approveOrg(admin: Page, legalName: string): Promise<void> {
  await admin.goto("/app/admin");
  const row = admin.getByRole("row").filter({ hasText: legalName });
  await row.getByRole("button", { name: "Approve" }).click();
  await row.getByRole("button", { name: "Confirm approve" }).click();
  await expect(admin.getByRole("row").filter({ hasText: legalName })).toHaveCount(0);
}
