// The demo seed (step 4.3; founder, 2026-10-02): Northwind Labs Demo Ltd, a devUSD organization, made
// through the app's own paths with the injected test wallet, so every record is the product's: the
// browser encrypts every amount, the owner's wallet signs every manifest and transaction.
// 1. Elif creates the organization in devUSD; an admin approves it; the worker attests it.
// 2. Elif sets up the account and funds the 1,500,000 devUSD treasury.
// 3. Elif adds the twelve and the two counterparties; each accepts, registers a viewing key and sets
//    up the account.
// 4. October's payroll: twelve lines of 4,000 to 12,000 devUSD, Maya's with gross and tax.
// 5. Atlas Freight is paid 48,200.00 and 12,750.00 devUSD, Halden OTC 500,000.00 devUSD.
// 6. Daniel accepts a viewing key for this month's payments and Elif shares the past records.
// 7. Maya reads her own payslip on My pay.
// 8. Elif proves a balance of at least 250,000 devUSD for Atlas Freight; /v/ shows Proven.
// The dry run is on localnet (SOTTO_SEED_TARGET unset); the live run waits for the founder's approval
// of its plan (seed-target.ts). Nothing is backdated: a grant for September would cover nothing,
// since every payment settles now (the step's report says so).
import { expect, test, type Browser, type Page } from "@playwright/test";
import { createKeyPairSignerFromBytes, type Address } from "@solana/kit";
import { connectWallet, csvValue, go, signInFromInvite, unlock } from "../flows.ts";
import {
  addTestWallet,
  ANY_APP_PAGE,
  approveOrg,
  clientAddress,
  OVERVIEW_URL,
  openSetup,
  signIn,
} from "../helpers.ts";
import {
  DANIEL,
  ELIF,
  NORTHWIND,
  PAYMENTS,
  PAYROLL,
  PROOF,
  RECIPIENTS,
  TREASURY,
  type Member,
} from "./northwind.ts";
import { seedTarget } from "./seed-target.ts";

const target = await seedTarget();
const PAY_URL = /\/app\/[0-9a-f-]{36}\/pay$/;
const RUN_URL = /\/app\/[0-9a-f-]{36}\/payroll\/[0-9a-f-]{36}$/;
const V1_WALLET = "window.__sottoTestWalletVersions = ['legacy', 0, 1];";

/** "48200.00" as the app shows it: "48200". */
const shown = (amount: string) => amount.replace(/\.?0+$/, "");

async function addressOf(member: Member): Promise<Address> {
  return (await createKeyPairSignerFromBytes(new Uint8Array(await target.keypair(member.key))))
    .address;
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

test.use({ actionTimeout: 60_000 });

test(`seeds Northwind Labs Demo Ltd on ${target.name}`, async ({ page, browser }) => {
  test.setTimeout(3_600_000 * target.slow);
  const elifKeypair = await target.keypair(ELIF.key);
  const elif = await createKeyPairSignerFromBytes(new Uint8Array(elifKeypair));
  const wallets = new Map<string, Address>();
  for (const member of [...RECIPIENTS, DANIEL]) wallets.set(member.key, await addressOf(member));
  await target.prepare(elif.address, 5n, TREASURY);
  for (const member of RECIPIENTS) await target.prepare(wallets.get(member.key) as Address, 1n, 0n);
  // What each wallet spends, for the live plan's cost (lamports before and after the seed).
  const lamports = async (wallet: Address) => (await target.rpc.getBalance(wallet).send()).value;
  const everyone: [string, Address][] = [
    ["elif", elif.address],
    ...RECIPIENTS.map((member): [string, Address] => [
      member.key,
      wallets.get(member.key) as Address,
    ]),
  ];
  const before = new Map<string, bigint>();
  for (const [key, wallet] of everyone) before.set(key, await lamports(wallet));
  await page.addInitScript({ content: V1_WALLET });
  let orgId = "";
  let recordAddress = "";

  await test.step("1. Elif creates the organization in devUSD; it is approved and attested", async () => {
    await signIn(page, elifKeypair);
    await page.getByLabel("Legal name").fill(NORTHWIND.legalName);
    await page.getByLabel("Display name").fill(NORTHWIND.displayName);
    await page.getByLabel("Country").selectOption(NORTHWIND.country);
    await page.getByLabel("Registration number").fill(NORTHWIND.registrationNo);
    await page.getByLabel("Website").fill(NORTHWIND.website);
    await page.getByLabel("Contact email").fill(NORTHWIND.contactEmail);
    await page.getByLabel("Currency").selectOption("devusd");
    await page.getByRole("button", { name: "Send for review" }).click();
    await expect(page.getByTestId("org-status")).toHaveText("In review");
    await expect(page.getByTestId("org-asset")).toContainText("devUSD");
    const admin = await newPage(browser);
    await signIn(admin, await target.admin(), ANY_APP_PAGE);
    await approveOrg(admin, NORTHWIND.legalName);
    await admin.context().close();
    await expect(async () => {
      await page.goto("/app/onboarding");
      await expect(page.getByTestId("attestation-address")).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 180_000 * target.slow });
    await page.goto("/app");
    await expect(page).toHaveURL(OVERVIEW_URL);
    orgId = OVERVIEW_URL.exec(new URL(page.url()).pathname)?.[1] ?? "";
    expect(orgId).not.toBe("");
  });

  await test.step("2. Elif sets up the account and funds the treasury", async () => {
    await openSetup(page);
    await unlock(page);
    await page.getByRole("button", { name: "Create viewing key" }).click();
    await expect(page.getByTestId("viewing-key-status")).toHaveText("Registered");
    await page.getByRole("button", { name: "Set up the account" }).click();
    await expect(page.getByTestId("account-status")).toHaveText("Set up");
    await expect(page.getByTestId("account-recorded")).toHaveText("Recorded");
    const funding = page.getByTestId("funding-card");
    await page.getByLabel("Amount of devUSD").fill(TREASURY.toString());
    await funding.getByRole("button", { name: "Fund account" }).click();
    await expect(funding.getByTestId("step-done")).toContainText(
      `Funded ${TREASURY} wdevUSD in two steps`,
      { timeout: 300_000 * target.slow },
    );
  });

  await test.step("3. The twelve and the two counterparties join and set up their accounts", async () => {
    await go(page, "Recipients");
    const form = page.getByTestId("add-recipient-card");
    const links = new Map<string, string>();
    for (const member of RECIPIENTS) {
      const wallet = wallets.get(member.key) as Address;
      await form.getByLabel("Name").fill(member.name);
      await form.getByLabel("Role").fill(member.role);
      await form.getByLabel("Team").fill(member.team);
      await form.getByLabel("Country").selectOption(member.country);
      await form.getByLabel("Solana wallet address").fill(wallet);
      await form.getByRole("button", { name: "Add recipient" }).click();
      const row = page.locator(`[data-testid="recipient-row"][data-wallet="${wallet}"]`);
      await expect(row).toContainText(member.name);
      await row.getByRole("button", { name: "Invite link" }).click();
      const link = page.getByLabel(`Invite link for ${member.name}`);
      await expect(link).toHaveValue(/\/app\/invite\/[A-Za-z0-9_-]{43}$/);
      links.set(member.key, new URL(await link.inputValue()).pathname);
    }
    for (const member of RECIPIENTS) {
      const recipient = await newPage(browser);
      await addTestWallet(recipient, await target.keypair(member.key));
      await recipient.goto(links.get(member.key) ?? "");
      await signInFromInvite(recipient);
      await recipient.getByRole("button", { name: "Accept invite" }).click();
      await expect(recipient.getByTestId("invite-joined")).toContainText(
        `You joined ${NORTHWIND.displayName}`,
      );
      await unlock(recipient);
      await recipient.getByRole("button", { name: "Create viewing key" }).click();
      await expect(recipient.getByTestId("viewing-key-status")).toHaveText("Registered");
      await recipient.getByRole("button", { name: "Set up the account" }).click();
      await expect(recipient.getByTestId("account-status")).toHaveText("Set up");
      await expect(recipient.getByTestId("account-recorded")).toHaveText("Recorded");
      await recipient.context().close();
    }
    await expect(async () => {
      await go(page, "Overview");
      await go(page, "Recipients");
      for (const member of RECIPIENTS) {
        await expect(
          page
            .locator(`[data-testid="recipient-row"][data-wallet="${wallets.get(member.key)}"]`)
            .getByTestId("recipient-readiness"),
        ).toHaveAttribute("data-readiness", "ready", { timeout: 2_000 });
      }
    }).toPass({ timeout: 180_000 * target.slow });
    await page.reload();
    await unlock(page);
  });

  await test.step("4. October's payroll for the twelve settles", async () => {
    await go(page, "Payroll");
    const csv = [
      "wallet,amount,memo,name,team,country,gross,tax",
      ...PAYROLL.map(
        (entry) =>
          `${wallets.get(entry.key)},${entry.net},${csvValue(entry.memo)},,,,${entry.gross ?? ""},${entry.tax ?? ""}`,
      ),
    ];
    await page.getByLabel("Payroll CSV").setInputFiles({
      name: "october-payroll.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv.join("\n")),
    });
    await expect(page.getByTestId("csv-summary")).toContainText(
      `${PAYROLL.length} lines from october-payroll.csv`,
    );
    await page.getByRole("button", { name: "Create run" }).click();
    await expect(page).toHaveURL(RUN_URL);
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("run-done")).toContainText(
      `${PAYROLL.length} lines were sent and confirmed`,
      { timeout: 900_000 * target.slow },
    );
    await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "settled", {
      timeout: 300_000 * target.slow,
    });
  });

  await test.step("5. Atlas Freight and Halden OTC are paid", async () => {
    for (const payment of PAYMENTS) {
      await go(page, "Payments");
      const pay = page.getByTestId("pay-card");
      const wallet = wallets.get(payment.to.key) as Address;
      await pay
        .getByLabel("Recipient")
        .selectOption({ label: `${payment.to.name} · ${wallet.slice(0, 4)}…${wallet.slice(-4)}` });
      await pay.getByLabel("Amount (devUSD)").fill(payment.amount);
      await pay.getByLabel("Memo").fill(payment.memo);
      await pay.getByLabel("Category").selectOption(payment.category);
      await pay.getByRole("button", { name: "Pay" }).click();
      await expect(page.getByTestId("payment-done")).toContainText(
        `Paid ${shown(payment.amount)} devUSD to ${payment.to.name}. Settled onchain`,
        { timeout: 300_000 * target.slow },
      );
    }
  });

  await test.step("6. Daniel holds a viewing key for this month's payments", async () => {
    const now = new Date();
    const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    await go(page, "Viewing keys");
    await page.getByTestId("open-grant").click();
    const drawer = page.getByRole("dialog", { name: "Grant a viewing key" });
    await drawer.getByLabel("Name").fill(DANIEL.name);
    await drawer.getByLabel("Role, optional").fill(DANIEL.role);
    await drawer.getByRole("button", { name: "One period" }).click();
    await drawer.getByLabel("From").fill(first.toISOString().slice(0, 10));
    await drawer.getByLabel("To, included").fill(last.toISOString().slice(0, 10));
    await drawer.getByRole("button", { name: "No expiry" }).click();
    await drawer.getByTestId("grant-key").click();
    const link = await drawer.getByTestId("grant-invite-link").inputValue();
    await drawer.getByRole("button", { name: "Done" }).click();
    const daniel = await newPage(browser);
    await addTestWallet(daniel, await target.keypair(DANIEL.key));
    await daniel.goto(new URL(link).pathname);
    await signInFromInvite(daniel);
    await daniel.getByRole("button", { name: "Accept invite" }).click();
    await expect(daniel.getByTestId("invite-joined")).toContainText("as its accountant");
    await connectWallet(daniel);
    await daniel.getByRole("button", { name: "Create viewing key" }).click();
    await expect(daniel.getByTestId("viewing-key-status")).toHaveText("Registered");
    await page.reload();
    const row = page.getByTestId("key-row").filter({ hasText: DANIEL.name });
    await expect(row.getByTestId("key-status")).toHaveText("Active");
    await unlock(page);
    const backfill = page.getByTestId("backfill");
    const records = PAYROLL.length + PAYMENTS.length;
    await expect(backfill.getByTestId("backfill-row")).toContainText(`${records} records in scope`);
    await backfill.getByRole("button", { name: "Share past records" }).click();
    await expect(backfill.getByTestId("backfill-message")).toHaveText(
      `Shared ${records} past records with ${DANIEL.name}, encrypted for them only.`,
      { timeout: 180_000 * target.slow },
    );
    await daniel.goto("/app");
    await expect(daniel).toHaveURL(new RegExp(`/app/${orgId}/books$`));
    await connectWallet(daniel);
    await daniel
      .getByTestId("viewing-unlock-card")
      .getByRole("button", { name: "Unlock with your wallet" })
      .click();
    await expect(daniel.getByTestId("ledger-row")).toHaveCount(records, {
      timeout: 120_000 * target.slow,
    });
    await daniel.context().close();
  });

  await test.step("7. Maya reads her own payslip", async () => {
    const maya = PAYROLL[0];
    if (!maya) throw new Error("no Maya");
    const recipient = await newPage(browser);
    await signIn(recipient, await target.keypair(maya.key), PAY_URL);
    await unlock(recipient);
    await expect(recipient.getByTestId("payslip-net")).toHaveText(`${shown(maya.net)} devUSD`);
    await expect(recipient.getByTestId("payslip-gross")).toHaveText(
      `${shown(maya.gross ?? "")} devUSD`,
    );
    await recipient.context().close();
  });

  await test.step("8. A proof of at least 250,000 devUSD for Atlas Freight shows Proven", async () => {
    await go(page, "Proofs");
    const builder = page.getByTestId("proof-builder");
    await builder.getByRole("button", { name: "Custom" }).click();
    await builder.getByLabel("Custom amount (devUSD)").fill(PROOF.threshold);
    await builder.getByLabel("Share the answer with").fill(PROOF.label);
    await builder.getByRole("button", { name: "Generate proof" }).click();
    const certificate = page.getByTestId("certificate");
    await expect(certificate).toHaveAttribute("data-result", "proven", {
      timeout: 300_000 * target.slow,
    });
    const href = await certificate
      .getByRole("link", { name: "Open the public page" })
      .getAttribute("href");
    recordAddress = /^\/v\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(href ?? "")?.[1] ?? "";
    expect(recordAddress).not.toBe("");
    const visitor = await newPage(browser);
    await visitor.goto(`/v/${recordAddress}`);
    await expect(visitor.getByTestId("verify-word")).toHaveText("Proven");
    await expect(visitor.getByTestId("verify-statement")).toHaveText(
      "Balance is at least 250,000 devUSD",
    );
    await expect(visitor.getByTestId("devnet-test-badge")).toBeVisible();
    await visitor.context().close();
    // Today's balance snapshot for the overview's growth card.
    await go(page, "Overview");
    await expect(page).toHaveURL(OVERVIEW_URL);
  });

  const spent: Record<string, string> = {};
  for (const [key, wallet] of everyone) {
    spent[key] = ((before.get(key) ?? 0n) - (await lamports(wallet))).toString();
  }
  console.log(`lamports spent per wallet: ${JSON.stringify(spent)}`);
  await target.record({
    lamportsSpent: spent,
    target: target.name,
    organization: NORTHWIND.legalName,
    orgId,
    owner: elif.address,
    wallets: Object.fromEntries(wallets),
    proofRecord: recordAddress,
    publicProof: `/v/${recordAddress}`,
    seededAt: new Date().toISOString(),
  });
});
