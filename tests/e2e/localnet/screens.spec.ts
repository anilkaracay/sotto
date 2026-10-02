// The account and money screens in every state (step 3.5, 13 A36 to A41): one owner meets the unlock
// explainer, a refused viewing key signature, the determinism refusal, a wallet that refuses the
// account setup, the setup, the funding in two signatures, the overview locked and unlocked, the
// withdraw drawer, and New payment blocked by screening, in progress, settled and refused by the
// wallet; a recipient meets the pay page locked, with a pending balance and after applying it, holding
// a payslip (category payroll) and a payment (category supplier) in one list, and saves the PDF of
// each (13 A49); the recovery guide last. Each state is checked for its words and saved as a full page screenshot at
// 1440 to this test's output directory and, once the run passes, to .demo-shots/screens/<UTC time>/
// (git ignored), for the founder's approval of the design pass. Runs in the localnet job of
// scripts/ci-local.sh against the bootstrapped validator, never devnet.
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { associatedTokenAccount } from "@sotto/sdk/confidential/public";
import { confidentialKeysMessage, deriveStandardKeys, viewKeyMessage } from "@sotto/sdk/keys";
import { keypairWallet, randomizedEd25519Signature } from "@sotto/sdk/testing";
import {
  fundLocalnetWallet,
  readLocalnetBootstrap,
  setUpLocalnetAccount,
  type LocalnetOwner,
} from "@sotto/sdk/testing/localnet";
import { createRetryingRpc } from "@sotto/sdk/tx";
import {
  createKeyPairSignerFromBytes,
  fetchEncodedAccount,
  signBytes,
  type Address,
} from "@solana/kit";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { e2eKeypair, seededKeypair } from "../fixtures.ts";
import {
  addTestWallet,
  ANY_APP_PAGE,
  approveOrg,
  clientAddress,
  openSetup,
  OVERVIEW_URL,
  signIn,
} from "../helpers.ts";
import { expectAccessible, expectQuietConsole, watchConsole } from "../a11y.ts";
import { expectVisual } from "../visual.ts";

const bootstrap = readLocalnetBootstrap();
const rpc = createRetryingRpc(bootstrap.rpcUrl);
const PAY_URL = /\/app\/[0-9a-f-]{36}\/pay$/;
// A new owner each run, so every setup state shows again on a ledger a previous run used.
const OWNER = seededKeypair(`sotto-e2e-screens-owner/${Date.now()}`);
const RECIPIENT = seededKeypair("sotto-e2e-screens-recipient/v1");
// On the localnet deny list (apps/web/lib/server/screening-denylist.ts), as in the payments spec.
const DENIED = seededKeypair("sotto-e2e-denied/v1");
const DEMO_SHOTS = fileURLToPath(new URL("../../../.demo-shots/screens/", import.meta.url));

type TestWallet = {
  refuse: (texts: string[]) => void;
  refuseTransactions: (refusal: { name: string; message: string } | null) => void;
  queueSignatures: (signatures: string[]) => void;
};

const shots: string[] = [];

/** A full page screenshot once fonts are in and the entrance animations have ended. */
async function shoot(page: Page, name: string, refused?: number) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  shots.push(path);
  // Step 3.8: the approved screen against its baseline.
  await expectVisual(page, name);
  // Step 3.10: no WCAG 2.1 A or AA violation in this state, and a quiet console up to it.
  await expectAccessible(page, name);
  expectQuietConsole(page, name, refused);
}

/** Calls one of the test wallet's controls (test-wallet.js) in the page. */
async function testWallet(page: Page, method: keyof TestWallet, ...args: unknown[]) {
  await page.evaluate(
    ([name, values]) => {
      const controls = (
        window as unknown as { __sottoTestWallet: Record<string, (...values: unknown[]) => void> }
      ).__sottoTestWallet;
      controls[name as string]?.(...(values as unknown[]));
    },
    [method, args] as const,
  );
}

/**
 * The test wallet awaits window.__sottoOnSignTransaction before it answers a transaction prompt;
 * every page here routes it to this hook. `atPrompt(skip, during)` lets `skip` prompts through, then
 * holds the next one while `during` runs, so a step's progress stays on screen.
 */
let onPrompt: (() => Promise<void>) | null = null;
function atPrompt(skip: number, during: () => Promise<void>): Promise<void> {
  let left = skip;
  return new Promise((resolve, reject) => {
    onPrompt = async () => {
      if (left > 0) {
        left -= 1;
        return;
      }
      onPrompt = null;
      try {
        await during();
        resolve();
      } catch (error) {
        reject(error as Error);
      }
    };
  });
}

async function chainRecipient(keypair: number[]): Promise<LocalnetOwner> {
  const signer = await createKeyPairSignerFromBytes(new Uint8Array(keypair));
  const funded = await fundLocalnetWallet(rpc, bootstrap, signer.address, { sol: 5n, usdc: 0n });
  const signature = new Uint8Array(
    await signBytes(signer.keyPair.privateKey, confidentialKeysMessage()),
  );
  return {
    signer,
    wallet: keypairWallet(signer),
    keys: await deriveStandardKeys(signer.address, signature),
    usdc: funded.usdc,
    wusdc: await associatedTokenAccount(signer.address, bootstrap.wrappedUsdcMint),
  };
}

async function newPage(browser: Browser): Promise<Page> {
  const baseURL = test.info().project.use.baseURL;
  const context = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: clientAddress(),
  });
  await context.exposeFunction("__sottoPromptHook", async () => {
    if (onPrompt) await onPrompt();
  });
  await context.addInitScript(() => {
    (
      window as unknown as { __sottoOnSignTransaction: () => Promise<void> }
    ).__sottoOnSignTransaction = () =>
      (window as unknown as { __sottoPromptHook: () => Promise<void> }).__sottoPromptHook();
  });
  const page = await context.newPage();
  watchConsole(page);
  return page;
}

async function connect(page: Page) {
  const connectButton = page.getByRole("button", { name: "Connect" });
  const signing = page.getByTestId("keys-wallet");
  await expect(connectButton.or(signing)).toBeVisible();
  if (await connectButton.isVisible()) await connectButton.click();
  await expect(signing).toBeVisible();
}

async function unlock(page: Page) {
  await connect(page);
  await page.getByRole("button", { name: "Unlock with your wallet" }).click();
  await expect(page.getByTestId("viewing-unlocked")).toHaveText("Unlocked");
}

test.use({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.14" } });

test("the account and money screens in every state, for the design pass (13 A36 to A41)", async ({
  browser,
}) => {
  test.setTimeout(900_000);
  const owner = await createKeyPairSignerFromBytes(new Uint8Array(OWNER.keypair));
  await fundLocalnetWallet(rpc, bootstrap, owner.address, { sol: 10n, usdc: 100n });
  for (const keypair of [RECIPIENT.keypair, DENIED.keypair]) {
    const who = await chainRecipient(keypair);
    const account = await fetchEncodedAccount(rpc, who.wusdc as Address, {
      commitment: "confirmed",
    });
    if (!account.exists) await setUpLocalnetAccount(rpc, who, bootstrap);
  }

  // The owner's organization, approved by the E2E admin.
  const page = await newPage(browser);
  await signIn(page, OWNER.keypair);
  await page.getByLabel("Legal name").fill("Northwind Screens Ltd");
  await page.getByLabel("Country").selectOption("NL");
  await page.getByLabel("Registration number").fill("KVK 35");
  await page.getByLabel("Website").fill("screens.example");
  await page.getByLabel("Contact email").fill("ops@screens.example");
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(page.getByTestId("org-status")).toHaveText("In review");
  const admin = await newPage(browser);
  await signIn(admin, e2eKeypair(), ANY_APP_PAGE);
  await approveOrg(admin, "Northwind Screens Ltd");
  await admin.context().close();

  // A40: the overview before the account exists.
  await page.goto("/app");
  await expect(page).toHaveURL(OVERVIEW_URL);
  await expect(page.getByTestId("account-address")).toHaveText("Not set up yet");
  await shoot(page, "01-overview-not-set-up");

  // A36: the setup page before the unlock, with the explainer and its warning.
  await openSetup(page);
  await connect(page);
  await expect(page.getByTestId("unlock-explainer")).toContainText(
    "Unlocking asks your wallet for two signatures, one after the other",
  );
  await expect(page.getByTestId("unlock-warning")).toContainText(
    "Anyone who has this signature can read the confidential balances of this wallet",
  );
  // Step 3.5: the three steps in order, the next one marked.
  const current = () => page.locator('[data-step][data-current="true"]');
  await expect(current()).toHaveAttribute("data-step", "1");
  await shoot(page, "02-setup-locked");

  // A36: the viewing key signature refused, the confidential keys unlocked.
  const viewText = new TextDecoder().decode(viewKeyMessage(OWNER.address));
  await testWallet(page, "refuse", [viewText]);
  await page.getByRole("button", { name: "Unlock with your wallet" }).click();
  await expect(page.getByTestId("keys-status")).toHaveText("Unlocked");
  await expect(page.getByTestId("viewing-missing")).toContainText(
    "Your wallet refused to sign the viewing key message.",
  );
  await shoot(page, "03-setup-viewing-key-refused");
  await testWallet(page, "refuse", []);
  await page.getByRole("button", { name: "Sign the viewing key message" }).click();
  await expect(page.getByTestId("viewing-unlocked")).toHaveText("Unlocked");
  await page.getByRole("button", { name: "Create viewing key" }).click();
  await expect(page.getByTestId("viewing-key-status")).toHaveText("Registered");

  // A37: the determinism refusal, from a wallet whose second key signature differs.
  const randomized = await randomizedEd25519Signature(
    new Uint8Array(OWNER.keypair.slice(0, 32)),
    confidentialKeysMessage(),
  );
  await testWallet(page, "queueSignatures", [Buffer.from(randomized).toString("base64")]);
  await page.getByRole("button", { name: "Set up the account" }).click();
  await expect(page.getByTestId("account-problem")).toContainText(
    "Your wallet signed the key message twice and gave two different signatures.",
  );
  await expect(current()).toHaveAttribute("data-step", "2");
  await shoot(page, "04-setup-determinism-refused");

  // A41: a wallet that refuses the account setup, with its own words.
  await testWallet(page, "refuseTransactions", {
    name: "WalletSignTransactionError",
    message: "Unable to verify this transaction. It cannot be signed.",
  });
  await page.getByRole("button", { name: "Set up the account" }).click();
  await expect(page.getByTestId("account-card").getByRole("alert")).toContainText(
    "Your wallet did not sign this confidential account setup.",
  );
  await shoot(page, "05-setup-wallet-refused");
  await testWallet(page, "refuseTransactions", null);

  // A37: the account set up, then funded in two signatures, seen at the second.
  await page.getByRole("button", { name: "Set up the account" }).click();
  await expect(page.getByTestId("account-status")).toHaveText("Set up");
  await expect(page.getByTestId("balance-available-value")).toHaveText("0 wUSDC");
  await expect(current()).toHaveAttribute("data-step", "3");
  await shoot(page, "06-setup-account-ready");
  const funding = page.getByTestId("funding-card");
  await page.getByLabel("Amount of USDC").fill("60");
  // The first prompt is wrap and deposit; the second, the apply, is held.
  const applyHeld = atPrompt(1, async () => {
    await expect(funding.getByRole("status").first()).toContainText("Step 2 of 2");
    await shoot(page, "07-setup-funding-step-2");
  });
  await funding.getByRole("button", { name: "Fund account" }).click();
  await applyHeld;
  await expect(funding.getByTestId("step-done")).toContainText("Funded 60 wUSDC in two steps");
  await expect(page.getByTestId("balance-available-value")).toHaveText("60 wUSDC");
  await shoot(page, "08-setup-funded");

  // A37 and A40: the overview unlocked, then locked.
  await page.getByRole("navigation").getByRole("link", { name: "Overview" }).click();
  await expect(page).toHaveURL(OVERVIEW_URL);
  await expect(page.getByTestId("balance-available-value")).toHaveText("60 wUSDC");
  await shoot(page, "09-overview-unlocked");
  await page.getByRole("button", { name: "Lock" }).first().click();
  await expect(page.getByTestId("keys-status")).toHaveText("Locked");
  await expect(page.getByTestId("balance-available-value")).toContainText("Unlock to see");
  await shoot(page, "10-overview-locked");
  await unlock(page);

  // A40: the withdraw drawer, its progress and its result.
  await page.getByTestId("open-withdraw").click();
  const drawer = page.getByRole("dialog", { name: "Withdraw" });
  await expect(drawer).toContainText("The withdrawn amount is public onchain");
  await drawer.getByLabel("Amount of wUSDC").fill("5");
  await shoot(page, "11-withdraw-drawer");
  const withdrawHeld = atPrompt(0, async () => {
    await expect(drawer.getByTestId("withdraw-progress")).toContainText("Step");
    await shoot(page, "12-withdraw-progress");
  });
  await drawer.getByRole("button", { name: "Withdraw and unwrap" }).click();
  await withdrawHeld;
  await expect(drawer.getByTestId("withdraw-done")).toContainText(
    "Withdrew 5 wUSDC and unwrapped it to 5 USDC",
    { timeout: 180_000 },
  );
  await shoot(page, "13-withdraw-done");
  await drawer.getByRole("button", { name: "Close" }).click();

  // The recipients: one who joins through the invite, one on the deny list.
  await page.getByRole("link", { name: "Recipients" }).click();
  const form = page.getByTestId("add-recipient-card");
  for (const [name, address] of [
    ["Maya Chen", RECIPIENT.address],
    ["Blocked Vendor", DENIED.address],
  ] as const) {
    await form.getByLabel("Name").fill(name);
    await form.getByLabel("Solana wallet address").fill(address);
    await form.getByRole("button", { name: "Add recipient" }).click();
    await expect(
      page
        .locator(`[data-testid="recipient-row"][data-wallet="${address}"]`)
        .getByTestId("recipient-readiness"),
    ).toHaveAttribute("data-readiness", "ready");
  }
  await page
    .locator(`[data-testid="recipient-row"][data-wallet="${RECIPIENT.address}"]`)
    .getByRole("button", { name: "Invite link" })
    .click();
  const inviteLink = await page.getByTestId("invite-link").inputValue();
  const recipient = await newPage(browser);
  await addTestWallet(recipient, RECIPIENT.keypair);
  await recipient.goto(new URL(inviteLink).pathname);
  await recipient.getByTestId("invite-sign-in").click();
  const option = recipient.getByTestId("wallet-option").filter({ hasText: "Sotto Test Wallet" });
  await option.getByRole("button", { name: "Connect" }).click();
  await option.getByRole("button", { name: "Sign in" }).click();
  await recipient.getByRole("button", { name: "Accept invite" }).click();
  await unlock(recipient);
  await recipient.getByRole("button", { name: "Create viewing key" }).click();
  await expect(recipient.getByTestId("viewing-key-status")).toHaveText("Registered");
  await recipient.context().close();

  // A39: New payment, blocked by screening, in progress, settled, then refused by the wallet. First a
  // payment of category payroll, so the recipient's pay page holds a payslip and a payment (A49).
  await page.getByRole("link", { name: "Payments" }).click();
  await expect(page).toHaveURL(/\/payments\/new$/);
  const pay = page.getByTestId("pay-card");
  await expect(pay).toContainText("A confidential wUSDC payment");
  const label = (name: string, address: string) =>
    `${name} · ${address.slice(0, 4)}…${address.slice(-4)}`;
  await pay.getByLabel("Recipient").selectOption({ label: label("Maya Chen", RECIPIENT.address) });
  await pay.getByLabel("Amount (USDC)").fill("2");
  await pay.getByLabel("Memo").fill("October advance");
  await pay.getByLabel("Category").selectOption("payroll");
  await pay.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByTestId("payment-done")).toContainText(
    "Paid 2 USDC to Maya Chen. Settled onchain",
    { timeout: 180_000 },
  );
  await page.goto(page.url());
  await unlock(page);
  await pay.getByLabel("Recipient").selectOption({ label: label("Maya Chen", RECIPIENT.address) });
  await pay.getByLabel("Amount (USDC)").fill("7.5");
  await pay.getByLabel("Memo").fill("September design work");
  await pay.getByLabel("Category").selectOption("supplier");
  await shoot(page, "14-payment-new");
  await pay
    .getByLabel("Recipient")
    .selectOption({ label: label("Blocked Vendor", DENIED.address) });
  // Picking a recipient puts their default amount in the field, so the amount comes after it.
  await pay.getByLabel("Amount (USDC)").fill("1");
  await pay.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByTestId("payment-problem")).toHaveText(
    "The recipient's wallet is on the screening list, so the payment is blocked",
  );
  await shoot(page, "15-payment-blocked", 422);
  await pay.getByLabel("Recipient").selectOption({ label: label("Maya Chen", RECIPIENT.address) });
  await pay.getByLabel("Amount (USDC)").fill("7.5");
  const paymentHeld = atPrompt(0, async () => {
    await expect(page.getByTestId("payment-progress")).toContainText("of");
    await shoot(page, "16-payment-progress");
  });
  await pay.getByRole("button", { name: "Pay" }).click();
  await paymentHeld;
  await expect(page.getByTestId("payment-done")).toContainText(
    "Paid 7.5 USDC to Maya Chen. Settled onchain",
    { timeout: 180_000 },
  );
  await shoot(page, "17-payment-done");
  await page.goto(page.url());
  await unlock(page);
  await testWallet(page, "refuseTransactions", {
    name: "WalletSignTransactionError",
    message: "User rejected the request.",
  });
  await pay.getByLabel("Recipient").selectOption({ label: label("Maya Chen", RECIPIENT.address) });
  await pay.getByLabel("Amount (USDC)").fill("1");
  await pay.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByTestId("payment-problem")).toContainText("Sotto Test Wallet said");
  await shoot(page, "18-payment-wallet-refused");
  await testWallet(page, "refuseTransactions", null);

  // A40: the recipient's pay page, locked, with the pending balance, and after applying it.
  const reader = await newPage(browser);
  await signIn(reader, RECIPIENT.keypair, PAY_URL);
  // Both transfers in "What your colleagues see" once the indexer read them (step 3.8: the shot
  // showed one or two rows depending on the indexer's timing).
  await expect(async () => {
    await reader.reload();
    await expect(reader.getByTestId("colleagues-row")).toHaveCount(2, { timeout: 3_000 });
  }).toPass({ timeout: 120_000 });
  await expect(reader.getByTestId("received-locked")).toContainText("sealed to your viewing key");
  await shoot(reader, "19-pay-locked");
  await unlock(reader);
  await expect(reader.getByTestId("withdraw-card")).toContainText("is in your pending balance");
  // A49: the supplier payment, the latest, reads as a payment; the payroll one as a payslip.
  const group = reader.getByTestId("pay-group").first();
  await expect(
    group.getByTestId("payslip-card").getByRole("heading", { name: "September design work" }),
  ).toBeVisible();
  await expect(group.getByTestId("payslip-card")).toContainText(
    "Payment from Northwind Screens LtdPaid ",
  );
  await expect(group.getByTestId("payslip-card")).toContainText("Amount received");
  await expect(group.getByTestId("payslip-card")).not.toContainText("Net pay");
  const received = group.getByTestId("received-card");
  await expect(received.getByRole("heading")).toHaveText("Payslips and payments");
  const rows = received.getByTestId("received-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute("data-label", "payment");
  await expect(rows.nth(0)).toContainText("September design work");
  await expect(rows.nth(0).getByTestId("received-label")).toContainText(
    "Payment from Northwind Screens Ltd · Paid",
  );
  await expect(rows.nth(0).getByTestId("received-label")).toContainText("· Supplier");
  await expect(rows.nth(1)).toHaveAttribute("data-label", "payslip");
  await expect(rows.nth(1)).toContainText("October advance");
  await expect(rows.nth(1).getByTestId("received-label")).toContainText("Payslip · Paid");
  await expect(group.getByTestId("pay-history")).toContainText("Received, USDC");
  await shoot(reader, "20-pay-pending");
  // Each row's PDF, made in the tab, kept with the screenshots for the founder.
  for (const [index, name, words] of [
    [
      0,
      "20-pay-payment-receipt",
      ["(Payment receipt: September design work) Tj", "(Amount received: 7.5 USDC) Tj"],
    ],
    [1, "20-pay-payslip", ["(Payslip: October advance) Tj", "(Net pay: 2 USDC) Tj"]],
  ] as const) {
    const downloading = reader.waitForEvent("download");
    await rows.nth(index).getByTestId("payslip-pdf").click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(
      index === 0 ? /^payment-receipt-\d{4}-\d{2}-\d{2}\.pdf$/ : /^payslip-\d{4}-\d{2}-\d{2}\.pdf$/,
    );
    const path = test.info().outputPath(`${name}.pdf`);
    await download.saveAs(path);
    const pdf = await readFile(path, "latin1");
    for (const word of words) expect(pdf).toContain(word);
    if (index === 0) expect(pdf).not.toMatch(/Payslip|Net pay|Gross|Tax withheld/);
    shots.push(path);
  }
  await reader.getByRole("button", { name: "Apply pending balance" }).click();
  await expect(reader.getByTestId("apply-done")).toContainText(
    "Applied your pending balance to your available balance.",
    { timeout: 120_000 },
  );
  await reader.getByTestId("withdraw-card").getByLabel("Amount of wUSDC").fill("2");
  await shoot(reader, "21-pay-withdraw");

  // A36: the recovery guide.
  await reader.goto("/app/recovery");
  await shoot(reader, "22-recovery");
  await reader.context().close();
  await page.context().close();

  // The run passed: the screenshots also go where Playwright never clears them.
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const folder = `${DEMO_SHOTS}${stamp}Z`;
  await mkdir(folder, { recursive: true });
  for (const path of shots) await copyFile(path, `${folder}/${path.split("/").pop()}`);
  console.log(`screens: ${folder}`);
});
