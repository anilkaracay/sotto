// The sharing and records screens in every state (step 3.6 with the admin console of step 3.4, 13 A35,
// A38, A42 to A47, A52): the admin reviews and approves a new owner's business; the owner meets the
// recipients page empty, with a refused wallet address, with a ready recipient and one without an
// account, sealed and unlocked, and an invite link shown once; the recipient meets the invite before
// sign in, signed in with another wallet, signed in with the invited wallet and after joining; the
// payroll page empty, with row errors, with a valid file and with its runs; the viewing keys page
// before a grant, the grant drawer, the link shown once and the key waiting; the accountant meets the
// invite before and after sign in and after joining; the owner shares the past records; the
// accountant's places, the books locked, unlocked, filtered to nothing, a payment's drawer and the
// export; the owner revokes the key and the accountant's books say so; the overview's what the chain
// shows; and the paused proof program banner, from a failing verdict the spec writes into the test
// database and puts back. Each state is checked for its words and saved as a full page screenshot at
// 1440 to this test's output directory and, once the run passes, to .demo-shots/screens/<UTC time>/
// (git ignored), for the founder's approval of the design pass. Sign in, onboarding, /v/ and /trust
// wait for their own designs and are not shown. Runs in the localnet job of scripts/ci-local.sh, one
// spec at a time (workers: 1), so the failing verdict reaches no other spec; never devnet.
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { clusterHealth, createDb } from "@sotto/db";
import { associatedTokenAccount } from "@sotto/sdk/confidential/public";
import { confidentialKeysMessage, deriveStandardKeys } from "@sotto/sdk/keys";
import { keypairWallet } from "@sotto/sdk/testing";
import {
  applyLocalnetPending,
  fundLocalnetAccount,
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
  clientAddress,
  openSetup,
  OVERVIEW_URL,
  signIn,
} from "../helpers.ts";
import { expectVisual } from "../visual.ts";

const bootstrap = readLocalnetBootstrap();
const rpc = createRetryingRpc(bootstrap.rpcUrl);
const RUN_URL = /\/app\/[0-9a-f-]{36}\/payroll\/[0-9a-f-]{36}$/;
const LEGAL = "Northwind Sharing Ltd";
// A new owner each run, so the admin console shows this run's business in review.
const OWNER = seededKeypair(`sotto-e2e-sharing-owner/${Date.now()}`);
const MAYA = seededKeypair("sotto-e2e-sharing-maya/v1");
// The accountant is also paid by the org, so their /app lists two places; their wallet never has a
// wUSDC account, so the recipients page shows "No account" for them.
const DANIEL = seededKeypair("sotto-e2e-sharing-daniel/v1");
const UNKNOWN = seededKeypair("sotto-e2e-sharing-unknown/v1");
const USDC = 1_000_000n;
const V1_WALLET = "window.__sottoTestWalletVersions = ['legacy', 0, 1];";
const DEMO_SHOTS = fileURLToPath(new URL("../../../.demo-shots/screens/", import.meta.url));
// server.ts writes the test database's address here for the banner state.
const DATABASE_URL_FILE = fileURLToPath(
  new URL("../../../.localnet/e2e-database-url", import.meta.url),
);

const shots: string[] = [];

/** A full page screenshot once fonts are in and the entrance animations have ended. */
async function shoot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  shots.push(path);
  // Step 3.8: the approved screen against its baseline.
  await expectVisual(page, name);
}

async function chainPerson(keypair: number[], usdc: bigint): Promise<LocalnetOwner> {
  const signer = await createKeyPairSignerFromBytes(new Uint8Array(keypair));
  const funded = await fundLocalnetWallet(rpc, bootstrap, signer.address, { sol: 2n, usdc });
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

async function ensureAccount(who: LocalnetOwner) {
  const account = await fetchEncodedAccount(rpc, who.wusdc as Address, {
    commitment: "confirmed",
  });
  if (!account.exists) await setUpLocalnetAccount(rpc, who, bootstrap);
}

async function newPage(browser: Browser): Promise<Page> {
  const baseURL = test.info().project.use.baseURL;
  const context = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    extraHTTPHeaders: clientAddress(),
  });
  const page = await context.newPage();
  await page.addInitScript({ content: V1_WALLET });
  return page;
}

/** Connects the wallet on a page with the wallet card, if this tab has not yet. */
async function connectWallet(page: Page) {
  const connect = page.getByRole("button", { name: "Connect" });
  const signing = page.getByTestId("keys-wallet");
  await expect(connect.or(signing)).toBeVisible();
  if (await connect.isVisible()) await connect.click();
  await expect(signing).toBeVisible();
}

/** Connects and unlocks both keys with one click; they stay open across client side navigation. */
async function unlock(page: Page) {
  await connectWallet(page);
  await page.getByRole("button", { name: "Unlock with your wallet" }).click();
  await expect(page.getByTestId("viewing-unlocked")).toHaveText("Unlocked");
}

/** An owner's page through the top nav, so the keys unlocked in the tab stay open. */
async function go(page: Page, name: string) {
  await page.getByRole("navigation").getByRole("link", { name, exact: true }).click();
}

/** Signs in from an invite page with the wallet the page's test wallet holds. */
async function signInFromInvite(page: Page) {
  await page.getByTestId("invite-sign-in").click();
  const option = page.getByTestId("wallet-option").filter({ hasText: "Sotto Test Wallet" });
  await option.getByRole("button", { name: "Connect" }).click();
  await option.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app\/invite\/[A-Za-z0-9_-]{43}$/);
}

const recipientRow = (page: Page, wallet: string) =>
  page.locator(`[data-testid="recipient-row"][data-wallet="${wallet}"]`);

async function uploadCsv(page: Page, name: string, rows: string[]) {
  await page.getByLabel("Payroll CSV").setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(["wallet,amount,memo,name,team,country", ...rows].join("\n")),
  });
}

test.use({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.15" } });

test("the sharing and records screens in every state, for the design pass (13 A35, A38, A42 to A47, A52)", async ({
  page,
  browser,
}) => {
  test.setTimeout(900_000);
  const owner = await chainPerson(OWNER.keypair, 100n);
  await ensureAccount(owner);
  await fundLocalnetAccount(rpc, owner, bootstrap, 40n * USDC);
  await applyLocalnetPending(rpc, owner);
  await ensureAccount(await chainPerson(MAYA.keypair, 0n));
  await chainPerson(DANIEL.keypair, 0n);

  await page.addInitScript({ content: V1_WALLET });
  await signIn(page, OWNER.keypair);
  await page.getByLabel("Legal name").fill(LEGAL);
  await page.getByLabel("Country").selectOption("NL");
  await page.getByLabel("Registration number").fill("KVK 36");
  await page.getByLabel("Website").fill("sharing.example");
  await page.getByLabel("Contact email").fill("ops@sharing.example");
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(page.getByTestId("org-status")).toHaveText("In review");

  // A35: the admin console, in review, the approval's confirmation, then active.
  const admin = await newPage(browser);
  await signIn(admin, e2eKeypair(), ANY_APP_PAGE);
  await admin.goto("/app/admin");
  const reviewRow = admin.getByTestId("admin-org-row").filter({ hasText: LEGAL });
  await expect(reviewRow).toContainText("In review");
  await shoot(admin, "01-admin-in-review");
  await reviewRow.getByRole("button", { name: "Approve" }).click();
  await expect(reviewRow.getByRole("button", { name: "Confirm approve" })).toBeVisible();
  await shoot(admin, "02-admin-confirm");
  await reviewRow.getByRole("button", { name: "Confirm approve" }).click();
  await expect(admin.getByTestId("admin-org-row").filter({ hasText: LEGAL })).toHaveCount(0);
  await admin.goto("/app/admin?status=active");
  await expect(admin.getByTestId("admin-org-row").filter({ hasText: LEGAL })).toContainText(
    "Active",
  );
  await shoot(admin, "03-admin-active");
  await admin.context().close();

  await page.goto("/app");
  await expect(page).toHaveURL(OVERVIEW_URL);
  const orgId = OVERVIEW_URL.exec(new URL(page.url()).pathname)?.[1] ?? "";
  await openSetup(page);
  await unlock(page);
  await page.getByRole("button", { name: "Create viewing key" }).click();
  await expect(page.getByTestId("viewing-key-status")).toHaveText("Registered");
  const origin = new URL(page.url()).origin;
  // The account the SDK set up, recorded as the setup page records it (the indexer reads it).
  const recorded = await page.request.post("/api/token-accounts", {
    headers: { origin },
    data: { orgId, address: owner.wusdc, keyScheme: "standard_v1" },
  });
  expect([200, 201]).toContain(recorded.status());

  // A38: the recipients page empty, a refused wallet address, two recipients sealed and unlocked,
  // and an invite link shown once.
  await go(page, "Recipients");
  await expect(page.getByTestId("recipients-card")).toContainText("No recipients yet");
  await shoot(page, "04-recipients-empty");
  const form = page.getByTestId("add-recipient-card");
  await form.getByLabel("Name").fill("Maya Chen");
  await form.getByLabel("Solana wallet address").fill("not a wallet");
  await form.getByRole("button", { name: "Add recipient" }).click();
  await expect(form.getByLabel("Solana wallet address")).toHaveAttribute("aria-invalid", "true");
  await shoot(page, "05-recipients-refused");
  await form.getByLabel("Role").fill("Design lead");
  await form.getByLabel("Team").fill("Design");
  await form.getByLabel("Country").selectOption("NL");
  await form.getByLabel("Default amount (USDC)").fill("1500");
  await form.getByLabel("Notes").fill("Monthly, first week");
  await form.getByLabel("Solana wallet address").fill(MAYA.address);
  await form.getByRole("button", { name: "Add recipient" }).click();
  await expect(recipientRow(page, MAYA.address)).toContainText("Maya Chen");
  await form.getByLabel("Name").fill("Daniel Osei");
  await form.getByLabel("Role").fill("Bookkeeper");
  await form.getByLabel("Team").fill("Finance");
  await form.getByLabel("Country").selectOption("NL");
  await form.getByLabel("Solana wallet address").fill(DANIEL.address);
  await form.getByRole("button", { name: "Add recipient" }).click();
  await expect(recipientRow(page, DANIEL.address)).toContainText("No account");
  await expect(recipientRow(page, MAYA.address).getByTestId("recipient-readiness")).toHaveAttribute(
    "data-readiness",
    "ready",
  );
  await page.getByRole("button", { name: "Lock" }).first().click();
  await expect(recipientRow(page, MAYA.address)).toContainText("Sealed");
  await shoot(page, "06-recipients-sealed");
  await unlock(page);
  await expect(recipientRow(page, MAYA.address).getByTestId("default-amount")).toHaveText(
    "1500 USDC",
  );
  await recipientRow(page, MAYA.address).getByRole("button", { name: "Invite link" }).click();
  const mayaLink = await page
    .getByRole("row")
    .filter({ hasText: "Send this link to Maya Chen" })
    .getByTestId("invite-link")
    .inputValue();
  await shoot(page, "07-recipients-invite-link");
  await recipientRow(page, DANIEL.address).getByRole("button", { name: "Invite link" }).click();
  const danielRecipientLink = await page
    .getByRole("row")
    .filter({ hasText: "Send this link to Daniel Osei" })
    .getByTestId("invite-link")
    .inputValue();

  // A38: the recipient invite before sign in, for another wallet, for the invited one, then joined.
  const maya = await newPage(browser);
  await addTestWallet(maya, MAYA.keypair);
  await maya.goto(new URL(mayaLink).pathname);
  await expect(maya.getByTestId("invite-card")).toContainText(
    `${LEGAL} invites you to receive payments in Sotto`,
  );
  await shoot(maya, "08-invite-before-sign-in");
  const daniel = await newPage(browser);
  await signIn(daniel, DANIEL.keypair);
  await daniel.goto(new URL(mayaLink).pathname);
  await expect(daniel.getByTestId("invite-wrong-wallet")).toContainText(MAYA.address);
  await shoot(daniel, "09-invite-other-wallet");
  await signInFromInvite(maya);
  await expect(maya.getByTestId("invite-details")).toContainText("Design lead");
  await shoot(maya, "10-invite-details");
  await maya.getByRole("button", { name: "Accept invite" }).click();
  await expect(maya.getByTestId("invite-joined")).toContainText(`You joined ${LEGAL}`);
  await shoot(maya, "11-invite-joined");
  await unlock(maya);
  await maya.getByRole("button", { name: "Create viewing key" }).click();
  await expect(maya.getByTestId("viewing-key-status")).toHaveText("Registered");
  await maya.context().close();
  // Daniel joins as a recipient too (no account set up), so he has a pay page.
  await daniel.goto(new URL(danielRecipientLink).pathname);
  await daniel.getByRole("button", { name: "Accept invite" }).click();
  await expect(daniel.getByTestId("invite-joined")).toContainText(`You joined ${LEGAL}`);

  // A42: the payroll page empty, with row errors, with a valid file, and its runs.
  await go(page, "Payroll");
  await expect(page.getByTestId("new-run-card")).toBeVisible();
  await shoot(page, "12-payroll-empty");
  await uploadCsv(page, "october.csv", [
    `${MAYA.address},1.5,October design,Maya Chen,Design,NL`,
    `${UNKNOWN.address},2,,,,`,
    `${DANIEL.address},0,,Daniel Osei,Finance,NL`,
  ]);
  const csvRows = page.getByTestId("csv-row");
  await expect(csvRows.nth(1).getByTestId("csv-row-error")).toHaveText("Add this recipient first");
  await shoot(page, "13-payroll-csv-errors");
  await uploadCsv(page, "october.csv", [`${MAYA.address},2.5,October salary,Maya Chen,Design,NL`]);
  await expect(page.getByTestId("csv-summary")).toContainText("1 line from october.csv");
  await shoot(page, "14-payroll-csv-ready");
  await page.getByRole("button", { name: "Create run" }).click();
  await expect(page).toHaveURL(RUN_URL);
  await page.getByTestId("run-button").click();
  await expect(page.getByTestId("run-done")).toContainText("1 line was sent and confirmed", {
    timeout: 180_000,
  });
  await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "settled", {
    timeout: 120_000,
  });
  await go(page, "Payroll");
  await expect(page.getByTestId("run-row")).toHaveCount(1);
  await shoot(page, "15-payroll-runs");

  // A single payment too, so the books hold two categories.
  await go(page, "Payments");
  const pay = page.getByTestId("pay-card");
  await pay.getByLabel("Recipient").selectOption({
    label: `Maya Chen · ${MAYA.address.slice(0, 4)}…${MAYA.address.slice(-4)}`,
  });
  await pay.getByLabel("Amount (USDC)").fill("4.2");
  await pay.getByLabel("Memo").fill("Brand workshop");
  await pay.getByLabel("Category").selectOption("supplier");
  await pay.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByTestId("payment-done")).toContainText("Paid 4.2 USDC", {
    timeout: 180_000,
  });

  // A43: the viewing keys page, the grant drawer, the link shown once, the key waiting.
  await go(page, "Viewing keys");
  await expect(page.getByTestId("keys-card")).toBeVisible();
  await shoot(page, "16-keys-before-grant");
  await page.getByTestId("open-grant").click();
  const drawer = page.getByRole("dialog", { name: "Grant a viewing key" });
  await drawer.getByLabel("Name").fill("Daniel Osei");
  await drawer.getByLabel("Role, optional").fill("Accountant, external");
  await drawer.getByRole("button", { name: "Every amount" }).click();
  await drawer.getByRole("button", { name: "End of quarter" }).click();
  await shoot(page, "17-keys-grant-drawer");
  await drawer.getByTestId("grant-key").click();
  const grantLink = await drawer.getByTestId("grant-invite-link").inputValue();
  await shoot(page, "18-keys-grant-link");
  await drawer.getByRole("button", { name: "Done" }).click();
  // Daniel's own payslips have a row of their own; this is the accountant's key.
  const keyRow = page.getByTestId("key-row").filter({ hasText: "Accountant, external" });
  await expect(keyRow.getByTestId("key-status")).toHaveText("Invite sent");
  await shoot(page, "19-keys-invite-sent");

  // A43: the accountant invite before sign in, signed in, joined, and with the viewing key.
  const guest = await newPage(browser);
  await addTestWallet(guest, DANIEL.keypair);
  await guest.goto(new URL(grantLink).pathname);
  await expect(guest.getByTestId("invite-card")).toContainText(
    "invites you to read its payment records in Sotto",
  );
  await shoot(guest, "20-accountant-invite");
  await guest.context().close();
  await daniel.goto(new URL(grantLink).pathname);
  await expect(daniel.getByTestId("invite-details")).toContainText("Every amount");
  await shoot(daniel, "21-accountant-invite-details");
  await daniel.getByRole("button", { name: "Accept invite" }).click();
  await expect(daniel.getByTestId("invite-joined")).toContainText("as its accountant");
  await shoot(daniel, "22-accountant-joined");
  await connectWallet(daniel);
  await daniel.getByRole("button", { name: "Create viewing key" }).click();
  await expect(daniel.getByTestId("viewing-key-status")).toHaveText("Registered");
  await shoot(daniel, "23-accountant-key-registered");

  // A43: the owner shares the past records.
  await page.reload();
  await expect(keyRow.getByTestId("key-status")).toHaveText("Active");
  await unlock(page);
  const backfill = page.getByTestId("backfill");
  const backfillRow = backfill.getByTestId("backfill-row");
  await expect(backfillRow).toContainText("Daniel Osei");
  await expect(backfillRow).toContainText("2 records in scope");
  await shoot(page, "24-keys-share-past");
  await backfill.getByRole("button", { name: "Share past records" }).click();
  await expect(backfill.getByTestId("backfill-message")).toHaveText(
    "Shared 2 past records with Daniel Osei, encrypted for them only.",
    { timeout: 60_000 },
  );
  await shoot(page, "25-keys-shared");

  // A47: the accountant's places and the books' viewing key card; A46: the books.
  await daniel.goto("/app");
  await expect(daniel.getByTestId("places")).toContainText(`Books of ${LEGAL}`);
  await expect(daniel.getByTestId("places")).toContainText(`Your pay from ${LEGAL}`);
  await shoot(daniel, "26-places");
  await daniel.getByRole("link", { name: `Books of ${LEGAL}` }).click();
  await expect(daniel.getByTestId("books-locked")).toContainText(
    "2 records are sealed to your viewing key.",
  );
  await shoot(daniel, "27-books-locked");
  await connectWallet(daniel);
  await daniel
    .getByTestId("viewing-unlock-card")
    .getByRole("button", { name: "Unlock with your wallet" })
    .click();
  await expect(daniel.getByTestId("viewing-unlocked")).toHaveText("Unlocked");
  const ledger = daniel.getByTestId("ledger-row");
  await expect(ledger).toHaveCount(2);
  await shoot(daniel, "28-books-unlocked");
  await daniel.getByLabel("Search the ledger").fill("no such memo");
  await expect(daniel.getByTestId("ledger-empty")).toBeVisible();
  await shoot(daniel, "29-books-no-match");
  await daniel.getByLabel("Search the ledger").fill("");
  await ledger.first().click();
  const detail = daniel.getByRole("dialog", { name: "Maya Chen" });
  await expect(detail.getByTestId("payment-detail")).toContainText("Sealed and settled on Solana");
  await shoot(daniel, "30-books-drawer");
  await detail.getByRole("button", { name: "Close" }).click();
  const downloading = daniel.waitForEvent("download");
  await daniel.getByTestId("export-csv").click();
  const exported = await readFile((await (await downloading).path()) as string, "utf8");
  expect(exported.split("\r\n")).toHaveLength(4);
  await expect(daniel.getByTestId("export-result")).toContainText("Exported 2 rows to CSV");
  await shoot(daniel, "31-books-exported");

  // A43: the revoke confirmation and the revoked key; the accountant's books say so.
  await go(page, "Viewing keys");
  await keyRow.getByTestId("key-toggle").click();
  await expect(keyRow.getByTestId("revoke-confirm")).toContainText(
    "Revoking stops access from now on. It cannot erase what was already viewed.",
  );
  await shoot(page, "32-keys-revoke-confirm");
  await keyRow.getByTestId("confirm-revoke").click();
  await expect(keyRow).toHaveAttribute("data-status", "revoked");
  await shoot(page, "33-keys-revoked");
  await daniel.reload();
  await expect(daniel.getByTestId("books-unavailable")).toHaveText(
    "You hold no active viewing key for this organization",
  );
  await shoot(daniel, "34-books-no-key");
  await daniel.context().close();

  // A44: what the chain shows on the overview, once the indexer read the transfers.
  await go(page, "Overview");
  await expect(page).toHaveURL(OVERVIEW_URL);
  await expect(async () => {
    await page.reload();
    await expect(page.locator('[data-testid="chain-row"][data-type="transfer_out"]')).toHaveCount(
      2,
      { timeout: 5_000 },
    );
  }).toPass({ timeout: 120_000 });
  await shoot(page, "35-overview-chain");

  // A52: the paused proof program banner, from a failing verdict written for this state only and
  // put back at once (the worker writes the next one within 5 minutes anyway).
  const database = createDb((await readFile(DATABASE_URL_FILE, "utf8")).trim(), { max: 1 });
  const [saved] = await database.db.select().from(clusterHealth);
  if (!saved) throw new Error("no proof program verdict");
  try {
    await database.db
      .update(clusterHealth)
      .set({ proofProgramOk: false, detail: "screens spec", checkedAt: new Date() });
    await page.reload();
    await expect(page.getByTestId("proof-program-banner")).toContainText(
      "Confidential actions are paused",
    );
    await shoot(page, "36-banner-paused");
  } finally {
    await database.db
      .update(clusterHealth)
      .set({ proofProgramOk: saved.proofProgramOk, detail: saved.detail, checkedAt: new Date() });
    await database.close();
  }
  await page.reload();
  await expect(page.getByTestId("proof-program-banner")).toHaveCount(0);
  await page.context().close();

  // The run passed: the screenshots also go where Playwright never clears them.
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const folder = `${DEMO_SHOTS}${stamp}Z-sharing`;
  await mkdir(folder, { recursive: true });
  for (const path of shots) await copyFile(path, `${folder}/${path.split("/").pop()}`);
  console.log(`screens: ${folder}`);
});
