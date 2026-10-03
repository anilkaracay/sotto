// The new devUSD elements on a local ledger, at 1440 and 390 (step 4.3; founder, 2026-10-03): the
// onboarding form's Currency field, the business details' Currency row, and the balance cards with the
// "Devnet test dollar" badge, which is no longer in the top bar. A review aid, not a test of CI.
import {
  fundLocalnetWallet,
  mintLocalnetDevusd,
  readLocalnetBootstrap,
} from "@sotto/sdk/testing/localnet";
import { createRetryingRpc } from "@sotto/sdk/tx";
import { address } from "@solana/kit";
import { expect, test } from "@playwright/test";
import { e2eKeypair, seededKeypair } from "../fixtures.ts";
import { unlock } from "../flows.ts";
import {
  ANY_APP_PAGE,
  approveOrg,
  clientAddress,
  OVERVIEW_URL,
  openSetup,
  signIn,
} from "../helpers.ts";
import { shoot } from "./shoot.ts";

const LEGAL_NAME = "Northwind Labs Demo Ltd";

test("the devUSD elements at 1440 and 390", async ({ page, browser }) => {
  const bootstrap = readLocalnetBootstrap();
  const rpc = createRetryingRpc(bootstrap.rpcUrl);
  const owner = seededKeypair("sotto-shots-devusd-owner/v1");
  await fundLocalnetWallet(rpc, bootstrap, address(owner.address), { sol: 5n, usdc: 0n });
  await mintLocalnetDevusd(rpc, bootstrap, address(owner.address), 20_000n);
  await page.addInitScript({ content: "window.__sottoTestWalletVersions = ['legacy', 0, 1];" });

  await signIn(page, owner.keypair);
  await page.getByLabel("Legal name").fill(LEGAL_NAME);
  await page.getByLabel("Display name").fill("Northwind Labs");
  await page.getByLabel("Country").selectOption("GB");
  await page.getByLabel("Registration number").fill("NW 0001");
  await page.getByLabel("Website").fill("northwind.example");
  await page.getByLabel("Contact email").fill("finance@northwind.example");
  await page.getByLabel("Currency").selectOption("devusd");
  await expect(page.getByTestId("asset-note")).toBeVisible();
  await shoot(page, "ui-01-onboarding-currency-field");

  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(page.getByTestId("org-status")).toHaveText("In review");
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL ?? "",
    extraHTTPHeaders: clientAddress(),
  });
  const admin = await context.newPage();
  await signIn(admin, e2eKeypair(), ANY_APP_PAGE);
  await approveOrg(admin, LEGAL_NAME);
  await context.close();
  await expect(async () => {
    await page.goto("/app/onboarding");
    await expect(page.getByTestId("attestation-address")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 120_000 });
  await expect(page.getByTestId("org-asset")).toContainText("devUSD");
  await shoot(page, "ui-02-business-details-currency-row");

  await page.goto("/app");
  await expect(page).toHaveURL(OVERVIEW_URL);
  await openSetup(page);
  await unlock(page);
  await page.getByRole("button", { name: "Create viewing key" }).click();
  await expect(page.getByTestId("viewing-key-status")).toHaveText("Registered");
  await page.getByRole("button", { name: "Set up the account" }).click();
  await expect(page.getByTestId("account-recorded")).toHaveText("Recorded");
  await page.getByTestId("funding-card").getByLabel("Amount of devUSD").fill("15000");
  await page.getByTestId("funding-card").getByRole("button", { name: "Fund account" }).click();
  await expect(page.getByTestId("funding-card").getByTestId("step-done")).toContainText(
    "Funded 15000 wdevUSD in two steps",
    { timeout: 180_000 },
  );
  await expect(page.getByTestId("balance-available-value")).toHaveText("15000 wdevUSD");
  // The badge is next to the balances, and not in the top bar.
  await expect(page.getByTestId("balances").getByTestId("devnet-test-badge")).toBeVisible();
  await expect(page.locator("header").getByTestId("devnet-test-badge")).toHaveCount(0);
  await shoot(page, "ui-03-balance-cards-badge", page.getByTestId("balances"));
});
