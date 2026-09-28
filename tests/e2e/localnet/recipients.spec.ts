// F-07 in the browser on localnet (step 1.8): the owner adds recipients, sees their readiness and why a
// recipient who is not ready cannot be paid, keeps a default amount sealed to the owner's own viewing
// key, and creates an invite link; the recipient opens it, signs in with the recipient's wallet,
// accepts, registers a viewing key and sets up the wUSDC account with the injected test wallet; the
// owner then sees the recipient ready, from chain state (AC-07.1 to AC-07.4). Since step 1.8.1 the
// default amounts open after one Unlock click on the recipients page, and the invite shows only the
// organization before sign in, the recipient's details only to the invited wallet and only the refusal
// with the expected address to another wallet. Runs in the localnet job of scripts/ci-local.sh against
// the bootstrapped validator, never devnet.
import { fundLocalnetWallet, readLocalnetBootstrap } from "@sotto/sdk/testing/localnet";
import { createRetryingRpc } from "@sotto/sdk/tx";
import { address } from "@solana/kit";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { e2eKeypair, seededKeypair } from "../fixtures.ts";
import { addTestWallet, clientAddress, openSetup, OVERVIEW_URL, signIn } from "../helpers.ts";

const bootstrap = readLocalnetBootstrap();
const rpc = createRetryingRpc(bootstrap.rpcUrl);
const RECIPIENTS_URL = /\/app\/[0-9a-f-]{36}\/recipients$/;
const OWNER = seededKeypair("sotto-e2e-recipients-owner/v1");
const RECIPIENT = seededKeypair("sotto-e2e-recipients-recipient/v1");
const NOT_READY = seededKeypair("sotto-e2e-recipients-not-ready/v1");

let inviteLink = "";

async function newPage(browser: Browser): Promise<Page> {
  const baseURL = test.info().project.use.baseURL;
  const context = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    extraHTTPHeaders: clientAddress(),
  });
  return context.newPage();
}

const row = (page: Page, wallet: string) =>
  page.locator(`[data-testid="recipient-row"][data-wallet="${wallet}"]`);

// This spec's own client address for its main page (helpers.ts clientAddress).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.11" } });

test.describe.serial("recipients on localnet", () => {
  test.beforeAll(async () => {
    await fundLocalnetWallet(rpc, bootstrap, address(RECIPIENT.address), { sol: 2n, usdc: 0n });
  });

  test("AC-07.1 AC-07.2 AC-07.4 adds recipients with readiness from chain, says why one cannot be paid, and keeps the default amount sealed", async ({
    page,
    browser,
  }) => {
    await signIn(page, OWNER.keypair);
    await page.getByLabel("Legal name").fill("Recipients Test Ltd");
    await page.getByLabel("Country").selectOption("DE");
    await page.getByLabel("Registration number").fill("HRB 18");
    await page.getByLabel("Website").fill("recipients.example");
    await page.getByLabel("Contact email").fill("ops@recipients.example");
    await page.getByRole("button", { name: "Send for review" }).click();
    await expect(page.getByTestId("org-status")).toHaveText("In review");

    // The E2E admin wallet approves it in its own session.
    const admin = await newPage(browser);
    await signIn(admin, e2eKeypair());
    await admin.goto("/app/admin");
    await admin.getByRole("button", { name: "Approve" }).click();
    await admin.getByRole("button", { name: "Confirm approve" }).click();
    await expect(admin.getByText("No organization is waiting for review.")).toBeVisible();
    await admin.context().close();

    // The owner's viewing key, which default amounts are sealed to.
    await page.goto("/app");
    await expect(page).toHaveURL(OVERVIEW_URL);
    await openSetup(page);
    await page.getByRole("button", { name: "Connect" }).click();
    await page.getByRole("button", { name: "Create viewing key" }).click();
    await expect(page.getByTestId("viewing-key-status")).toHaveText("Registered");

    await page.getByRole("link", { name: "Recipients" }).click();
    await expect(page).toHaveURL(RECIPIENTS_URL);
    const form = page.getByTestId("add-recipient-card");
    await form.getByLabel("Name").fill("Maya Chen");
    await form.getByLabel("Role").fill("Design lead");
    await form.getByLabel("Team").fill("Design");
    await form.getByLabel("Country").selectOption("GB");
    await form.getByLabel("Default amount (USDC)").fill("1500");
    await form.getByLabel("Notes").fill("Monthly, first week");
    await form.getByLabel("Solana wallet address").fill(RECIPIENT.address);
    await form.getByRole("button", { name: "Add recipient" }).click();
    await expect(row(page, RECIPIENT.address)).toContainText("Maya Chen");
    await expect(row(page, RECIPIENT.address).getByTestId("recipient-readiness")).toHaveAttribute(
      "data-readiness",
      "no_account",
    );
    // AC-07.4: why this recipient cannot be paid confidentially yet.
    await expect(row(page, RECIPIENT.address)).toContainText(
      "Cannot be paid confidentially yet: there is no wUSDC account at this wallet.",
    );
    await expect(row(page, RECIPIENT.address)).toContainText("Sealed");

    await form.getByLabel("Name").fill("Idris Kaya");
    await form.getByLabel("Solana wallet address").fill(NOT_READY.address);
    await form.getByRole("button", { name: "Add recipient" }).click();
    await expect(row(page, NOT_READY.address)).toContainText("No account");
    await expect(row(page, NOT_READY.address)).toContainText("None");

    // The default amount opens only in this tab, with the owner's viewing key: one Unlock click signs
    // the confidential key message and then the viewing key message (step 1.8.1).
    await expect(page.getByTestId("amounts-sealed-note")).toBeVisible();
    await page.getByRole("button", { name: "Unlock with your wallet" }).click();
    await expect(page.getByTestId("viewing-unlocked")).toHaveText("Unlocked");
    await expect(row(page, RECIPIENT.address).getByTestId("default-amount")).toHaveText(
      "1500 USDC",
    );
    await expect(page.getByTestId("amounts-sealed-note")).toHaveCount(0);
    await expect(row(page, RECIPIENT.address)).toContainText("Monthly, first week");

    await row(page, RECIPIENT.address).getByRole("button", { name: "Invite link" }).click();
    const link = page.getByTestId("invite-link");
    await expect(link).toHaveValue(/\/app\/invite\/[A-Za-z0-9_-]{43}$/);
    inviteLink = await link.inputValue();
  });

  test("AC-07.3 the recipient accepts the invite with its wallet, registers a viewing key and sets up the account, and becomes ready", async ({
    page,
    browser,
  }) => {
    const invitePath = new URL(inviteLink).pathname;

    // Another signed in wallet sees only the refusal with the expected address.
    const other = await newPage(browser);
    await signIn(other, NOT_READY.keypair);
    await other.goto(invitePath);
    await expect(other.getByTestId("invite-wrong-wallet")).toContainText(RECIPIENT.address);
    await expect(other.getByTestId("invite-card")).not.toContainText("Maya Chen");
    await expect(other.getByTestId("invite-details")).toHaveCount(0);
    await other.context().close();

    // Before sign in: the organization and the sign in button only.
    const recipient = await newPage(browser);
    await addTestWallet(recipient, RECIPIENT.keypair);
    await recipient.goto(invitePath);
    const card = recipient.getByTestId("invite-card");
    await expect(card).toContainText(
      "Recipients Test Ltd invites you to receive payments in Sotto",
    );
    await expect(card.getByTestId("invite-sign-in")).toBeVisible();
    await expect(card).not.toContainText("Maya Chen");
    await expect(card).not.toContainText("Design lead");
    await expect(card).not.toContainText(RECIPIENT.address);
    await recipient.getByTestId("invite-sign-in").click();
    await expect(recipient).toHaveURL(/\/app\/sign-in\?next=/);
    const option = recipient.getByTestId("wallet-option").filter({ hasText: "Sotto Test Wallet" });
    await option.getByRole("button", { name: "Connect" }).click();
    await option.getByRole("button", { name: "Sign in" }).click();
    await expect(recipient).toHaveURL(/\/app\/invite\/[A-Za-z0-9_-]{43}$/);
    // The invited wallet sees the recipient's name, role and wallet.
    const details = recipient.getByTestId("invite-details");
    await expect(details).toContainText("Maya Chen");
    await expect(details).toContainText("Design lead");
    await expect(details).toContainText(RECIPIENT.address);
    await recipient.getByRole("button", { name: "Accept invite" }).click();
    await expect(recipient.getByTestId("invite-joined")).toContainText(
      "You joined Recipients Test Ltd",
    );

    // One Unlock click gives both keys; registering the viewing key then takes one signature.
    await recipient.getByRole("button", { name: "Unlock with your wallet" }).click();
    await expect(recipient.getByTestId("keys-status")).toHaveText("Unlocked");
    await expect(recipient.getByTestId("viewing-unlocked")).toHaveText("Unlocked");
    await recipient.getByRole("button", { name: "Create viewing key" }).click();
    await expect(recipient.getByTestId("viewing-key-status")).toHaveText("Registered");
    const keyMessages = (
      await recipient.evaluate(
        () =>
          (window as unknown as { __sottoTestWallet: { signedMessages: string[] } })
            .__sottoTestWallet.signedMessages,
      )
    ).filter((text) => text.startsWith("solana-conf-bal") || text.startsWith("sotto-view-key"));
    expect(keyMessages).toEqual([
      "solana-conf-bal/v1",
      `sotto-view-key/v1\n${RECIPIENT.address}`,
      expect.stringMatching(/^sotto-view-key-register\/v1\n/),
    ]);
    await recipient.getByRole("button", { name: "Set up the account" }).click();
    await expect(recipient.getByTestId("account-status")).toHaveText("Set up");
    await expect(recipient.getByTestId("account-recorded")).toHaveText("Recorded");
    await recipient.context().close();

    // The owner sees the recipient ready, from chain state, and the other one still without account.
    await signIn(page, OWNER.keypair, OVERVIEW_URL);
    await page.getByRole("link", { name: "Recipients" }).click();
    await expect(row(page, RECIPIENT.address).getByTestId("recipient-readiness")).toHaveAttribute(
      "data-readiness",
      "ready",
    );
    await expect(row(page, RECIPIENT.address)).toContainText("Joined");
    await expect(
      row(page, RECIPIENT.address).getByRole("button", { name: "Invite link" }),
    ).toHaveCount(0);
    await expect(row(page, NOT_READY.address).getByTestId("recipient-readiness")).toHaveAttribute(
      "data-readiness",
      "no_account",
    );
    await row(page, NOT_READY.address).getByRole("button", { name: "Check again" }).click();
    await expect(row(page, NOT_READY.address)).toContainText("No account");
  });
});
