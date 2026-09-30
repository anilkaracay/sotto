// F-10 and F-14 in the browser on localnet (step 2.4). The owner pays a recipient once and runs a one
// line payroll, then grants an accountant a key for every amount with No expiry through the viewing
// keys page; the accountant opens the invite link, signs in with their own wallet, accepts and creates
// their viewing key, and the grant activates (AC-10.1, AC-10.2). The owner shares the past records
// (AC-10.3): the accountant's fetch returns the payment and the payroll line, each verified against
// the owner's manifest (I-9) and opened with the accountant's viewing key. A new payment reaches the
// accountant without any step of the owner's (AC-06.4). Revoking leaves the accountant's fetch empty
// (AC-10.4). The access log shows these events and no amount appears in it or in any request of the
// owner's (AC-10.5, AC-14.1, I-2). Expiry is tested with the worker's job and the API (a browser spec
// cannot wait for it). Since step 2.5 the accountant also reads the books (AC-11.1 to AC-11.4): /app
// opens them, the viewing key unlocks alone, the ledger shows the three payments of the grant's scope
// with the money out total, filters and searches in memory, marks a payment reconciled and exports the
// rows shown as CSV, with the export in the owner's access log; after the revocation the books say that
// nothing is shared. The owner's overview lists the payroll line with the payments and names the
// accountant as a reader, and what the chain shows comes from the indexed chain only (AC-05.3), with
// every confidential transfer sealed. Runs in the localnet job of scripts/ci-local.sh, never on devnet.
import { readFile } from "node:fs/promises";
import { associatedTokenAccount } from "@sotto/sdk/confidential/public";
import { validateManifest, verifyManifest } from "@sotto/sdk/disclosure";
import { openPayload } from "@sotto/sdk/disclosure/seal";
import {
  confidentialKeysMessage,
  deriveStandardKeys,
  deriveViewingKey,
  viewKeyMessage,
} from "@sotto/sdk/keys";
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
  clientAddress,
  expectAmountsWrapped,
  openSetup,
  OVERVIEW_URL,
  signIn,
} from "../helpers.ts";

const bootstrap = readLocalnetBootstrap();
const rpc = createRetryingRpc(bootstrap.rpcUrl);
const RUN_URL = /\/app\/[0-9a-f-]{36}\/payroll\/[0-9a-f-]{36}$/;
const OWNER = seededKeypair("sotto-e2e-grants-owner/v1");
const MAYA = seededKeypair("sotto-e2e-grants-maya/v1");
const DANIEL = seededKeypair("sotto-e2e-grants-accountant/v1");
const USDC = 1_000_000n;
/** I-2: amounts never used for a deposit or a withdrawal, and memos. */
const FIRST = { amount: "3.141592", base: "3141592", memo: "Invoice sentinel 3141" };
const LINE = { amount: "2.718281", base: "2718281", memo: "Salary sentinel 2718" };
const LATER = { amount: "1.414213", base: "1414213", memo: "Invoice sentinel 1414" };
const V1_WALLET = "window.__sottoTestWalletVersions = ['legacy', 0, 1];";

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

async function viewingKeyOf(keypair: number[]) {
  const signer = await createKeyPairSignerFromBytes(new Uint8Array(keypair));
  const signature = new Uint8Array(
    await signBytes(signer.keyPair.privateKey, viewKeyMessage(signer.address)),
  );
  return deriveViewingKey(signer.address, signature);
}

async function newPage(browser: Browser): Promise<Page> {
  const baseURL = test.info().project.use.baseURL;
  const context = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    extraHTTPHeaders: clientAddress(),
  });
  return context.newPage();
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

/** The caller's records in the org, each verified against the owner's manifest, then opened. */
async function readRecords(
  page: Page,
  orgId: string,
  viewer: { userId: string; keys: { publicKey: Uint8Array; secretKey: Uint8Array } },
) {
  const response = await page.request.get(`/api/orgs/${orgId}/disclosures`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    items: { id: string; kind: string; ciphertext: string; manifestId: string }[];
    manifests: { id: string; manifest: unknown; signature: string }[];
  };
  const opened = [];
  for (const item of body.items) {
    const stored = body.manifests.find((entry) => entry.id === item.manifestId);
    if (!stored) throw new Error("manifest missing");
    const manifest = validateManifest(stored.manifest);
    expect(
      await verifyManifest({
        manifest,
        signature: new Uint8Array(Buffer.from(stored.signature, "base64")),
        ownerWallet: OWNER.address,
        org: orgId,
      }),
    ).toEqual({ ok: true });
    expect(
      manifest.items.some((entry) => entry.id === item.id && entry.viewer === viewer.userId),
    ).toBe(true);
    opened.push(
      await openPayload(new Uint8Array(Buffer.from(item.ciphertext, "base64")), viewer.keys),
    );
  }
  return opened;
}

async function pay(page: Page, input: { amount: string; memo: string }) {
  await go(page, "Payments");
  await expect(page).toHaveURL(/\/payments\/new$/);
  const card = page.getByTestId("pay-card");
  await card.getByLabel("Recipient").selectOption({
    label: `Maya Chen · ${MAYA.address.slice(0, 4)}…${MAYA.address.slice(-4)}`,
  });
  await card.getByLabel("Amount (USDC)").fill(input.amount);
  await card.getByLabel("Memo").fill(input.memo);
  await card.getByRole("button", { name: "Pay" }).click();
  await expect(page.getByTestId("payment-done")).toContainText(`Paid ${input.amount} USDC`, {
    timeout: 180_000,
  });
}

test.use({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.40" } });

test.describe.serial("viewing grants on localnet", () => {
  let owner: LocalnetOwner;

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    owner = await chainPerson(OWNER.keypair, 100n);
    await ensureAccount(owner);
    await fundLocalnetAccount(rpc, owner, bootstrap, 30n * USDC);
    await applyLocalnetPending(rpc, owner);
    await ensureAccount(await chainPerson(MAYA.keypair, 0n));
  });

  test("AC-10.1 AC-10.2 AC-10.3 AC-10.4 AC-10.5 AC-06.4 AC-14.1 AC-11.1 AC-11.2 AC-11.3 AC-11.4 AC-05.3 grants an accountant a key through an invite, shares past payments and payroll lines, reaches them with a new payment, lets them read and export the books, shows what the chain shows, and revokes it", async ({
    page,
    browser,
  }) => {
    test.setTimeout(720_000);
    await page.addInitScript({ content: V1_WALLET });
    await signIn(page, OWNER.keypair);
    await page.getByLabel("Legal name").fill("Grants Test Ltd");
    await page.getByLabel("Country").selectOption("NL");
    await page.getByLabel("Registration number").fill("KVK 29");
    await page.getByLabel("Website").fill("grants.example");
    await page.getByLabel("Contact email").fill("ops@grants.example");
    await page.getByRole("button", { name: "Send for review" }).click();
    await expect(page.getByTestId("org-status")).toHaveText("In review");
    const admin = await newPage(browser);
    await signIn(admin, e2eKeypair());
    await admin.goto("/app/admin");
    await admin.getByRole("button", { name: "Approve" }).click();
    await admin.getByRole("button", { name: "Confirm approve" }).click();
    await expect(admin.getByText("No organization is waiting for review.")).toBeVisible();
    await admin.context().close();
    await page.goto("/app");
    await expect(page).toHaveURL(OVERVIEW_URL);
    const orgId = OVERVIEW_URL.exec(new URL(page.url()).pathname)?.[1] ?? "";
    await openSetup(page);
    await unlock(page);
    await page.getByRole("button", { name: "Create viewing key" }).click();
    await expect(page.getByTestId("viewing-key-status")).toHaveText("Registered");
    const origin = new URL(page.url()).origin;
    const added = await page.request.post(`/api/orgs/${orgId}/recipients`, {
      headers: { origin },
      data: { displayName: "Maya Chen", wallet: MAYA.address, team: "Design", country: "NL" },
    });
    expect(added.status()).toBe(201);
    // The account the SDK set up, recorded as the setup page records it (the indexer reads it).
    const recorded = await page.request.post("/api/token-accounts", {
      headers: { origin },
      data: { orgId, address: owner.wusdc, keyScheme: "standard_v1" },
    });
    expect([200, 201]).toContain(recorded.status());
    const traffic: string[] = [];
    page.on("request", (request) => {
      traffic.push(request.url());
      traffic.push(request.postData() ?? "");
    });

    // Before the grant: a single payment and a payroll line.
    await pay(page, FIRST);
    await go(page, "Payroll");
    const csv = [
      "wallet,amount,memo,name,team,country",
      `${MAYA.address},${LINE.amount},${LINE.memo},,,`,
    ];
    await page.getByLabel("Payroll CSV").setInputFiles({
      name: "one.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv.join("\n")),
    });
    await page.getByRole("button", { name: "Create run" }).click();
    await expect(page).toHaveURL(RUN_URL);
    await page.getByTestId("run-button").click();
    await expect(page.getByTestId("run-done")).toContainText("1 line was sent and confirmed", {
      timeout: 180_000,
    });
    await expect(page.getByTestId("run-status")).toHaveAttribute("data-status", "settled", {
      timeout: 120_000,
    });

    // AC-10.1: the grant drawer, every amount, No expiry; the link is shown once.
    await go(page, "Viewing keys");
    await page.getByTestId("open-grant").click();
    const drawer = page.getByRole("dialog", { name: "Grant a viewing key" });
    await drawer.getByLabel("Name").fill("Daniel Osei");
    await drawer.getByLabel("Role, optional").fill("Accountant, external");
    await drawer.getByRole("button", { name: "Every amount" }).click();
    await drawer.getByRole("button", { name: "No expiry" }).click();
    await expect(drawer.getByTestId("grant-preview")).toContainText("No expiry");
    await drawer.getByTestId("grant-key").click();
    const link = await drawer.getByTestId("grant-invite-link").inputValue();
    await drawer.getByRole("button", { name: "Done" }).click();
    const row = page.getByTestId("key-row").filter({ hasText: "Daniel Osei" });
    await expect(row.getByTestId("key-status")).toHaveText("Invite sent");

    // AC-10.2: the accountant accepts with their own wallet and creates their viewing key.
    const daniel = await newPage(browser);
    await addTestWallet(daniel, DANIEL.keypair);
    await daniel.goto(new URL(link).pathname);
    await expect(daniel.getByTestId("invite-card")).toContainText(
      "invites you to read its payment records in Sotto",
    );
    await daniel.getByTestId("invite-sign-in").click();
    const option = daniel.getByTestId("wallet-option").filter({ hasText: "Sotto Test Wallet" });
    await option.getByRole("button", { name: "Connect" }).click();
    await option.getByRole("button", { name: "Sign in" }).click();
    await expect(daniel.getByTestId("invite-details")).toContainText("Every amount");
    // Before acceptance the page shows the organization, the scope, the expiry and the link's
    // deadline, nothing else.
    await expect(daniel.getByTestId("invite-card")).toContainText(
      "Grants Test Ltd invites you to read its payment records in Sotto",
    );
    await expect(daniel.getByTestId("invite-details")).toContainText("No expiry");
    await expect(daniel.getByTestId("invite-details")).toContainText("Link valid until");
    const shown = await daniel.locator("body").innerText();
    for (const hidden of [
      "Daniel Osei",
      "Accountant, external",
      "Maya Chen",
      MAYA.address,
      ...[FIRST, LINE].flatMap((value) => [value.amount, value.base, value.memo]),
    ]) {
      expect(shown).not.toContain(hidden);
    }
    await daniel.getByRole("button", { name: "Accept invite" }).click();
    await expect(daniel.getByTestId("invite-joined")).toContainText("as its accountant");
    await connectWallet(daniel);
    await daniel.getByRole("button", { name: "Create viewing key" }).click();
    await expect(daniel.getByTestId("viewing-key-status")).toHaveText("Registered");
    const danielMe = (await (await daniel.request.get("/api/me")).json()) as {
      user: { id: string };
    };
    const danielKeys = { userId: danielMe.user.id, keys: await viewingKeyOf(DANIEL.keypair) };
    expect(await readRecords(daniel, orgId, danielKeys)).toEqual([]);

    // AC-10.3: the owner shares the past records in scope (a reload shows the active key, and the
    // keys unlock again in the new page).
    await page.reload();
    await expect(row.getByTestId("key-status")).toHaveText("Active");
    await unlock(page);
    const backfill = page.getByTestId("backfill");
    await expect(backfill.getByTestId("backfill-row")).toContainText(
      "Daniel Osei 2 records in scope",
    );
    await backfill.getByRole("button", { name: "Share past records" }).click();
    await expect(backfill.getByTestId("backfill-message")).toHaveText(
      "Shared 2 past records with Daniel Osei, encrypted for them only.",
      { timeout: 60_000 },
    );
    const past = await readRecords(daniel, orgId, danielKeys);
    expect(past.map((record) => [record.kind, record.amount, record.memo]).sort()).toEqual([
      ["payment", FIRST.base, FIRST.memo],
      ["payroll_line", LINE.base, LINE.memo],
    ]);
    // 13 A26: the run's "Who can read this run" names the holder once they hold its lines.
    await go(page, "Payroll");
    await page.getByTestId("run-row").first().getByRole("link").click();
    await expect(page).toHaveURL(RUN_URL);
    await expect(page.getByTestId("who-reader")).toHaveText("Daniel Osei, every line");

    // AC-06.4: a new payment reaches the accountant with no step of the owner's.
    await pay(page, LATER);
    const now = await readRecords(daniel, orgId, danielKeys);
    expect(now.map((record) => record.amount).sort()).toEqual(
      [FIRST.base, LINE.base, LATER.base].sort(),
    );

    // The overview lists the payroll line with the payments, and names the accountant as a reader.
    await go(page, "Overview");
    const activity = page.getByTestId("activity-row");
    await expect(activity).toHaveCount(3);
    await expect(
      page.locator('[data-testid="activity-row"][data-kind="payroll_line"]'),
    ).toHaveCount(1);
    for (const readers of await page.getByTestId("activity-readers").all()) {
      await expect(readers).toHaveAttribute("title", "Daniel Osei");
    }

    // AC-11.1: /app opens the books of the org, the only place the accountant has.
    const booksTraffic: string[] = [];
    daniel.on("request", (request) => {
      booksTraffic.push(request.url());
      booksTraffic.push(request.postData() ?? "");
    });
    await daniel.goto("/app");
    await expect(daniel).toHaveURL(new RegExp(`/app/${orgId}/books$`));
    await expect(daniel.getByTestId("scope-banner")).toContainText("Every amount · No expiry");
    await expect(daniel.getByTestId("books-locked")).toContainText(
      "3 records are sealed to your viewing key.",
    );
    await connectWallet(daniel);
    await daniel
      .getByTestId("viewing-unlock-card")
      .getByRole("button", { name: "Unlock with your wallet" })
      .click();
    await expect(daniel.getByTestId("viewing-unlocked")).toHaveText("Unlocked");
    // AC-11.2: the ledger opened in the tab, exactly the grant's three payments.
    const ledger = daniel.getByTestId("ledger-row");
    await expect(ledger).toHaveCount(3);
    await expect(daniel.getByTestId("money-out-total")).toHaveText("7.274086 USDC");
    // AC-15.1: with the privacy screen on, every amount on the page is inside Amount.
    await expectAmountsWrapped(daniel, "books");
    const payroll = daniel
      .getByTestId("ledger")
      .getByRole("button", { name: "Payroll", exact: true });
    await payroll.click();
    await expect(ledger).toHaveCount(1);
    await expect(ledger.first()).toContainText(LINE.memo);
    await daniel.getByTestId("ledger").getByRole("button", { name: "All", exact: true }).click();
    await daniel.getByLabel("Search the ledger").fill(FIRST.memo);
    await expect(ledger).toHaveCount(1);
    await expect(ledger.first().getByTestId("ledger-amount")).toHaveText(`${FIRST.amount} USDC`);
    // AC-11.3: the drawer shows what each party sees, and the accountant marks it reconciled.
    await ledger.first().click();
    const detail = daniel.getByRole("dialog", { name: "Maya Chen" });
    await expect(detail.getByTestId("payment-detail")).toContainText("Recipient clear");
    await expect(detail.getByTestId("payment-detail")).toContainText(
      "Sealed and settled on Solana",
    );
    await detail.getByTestId("mark-reconciled").click();
    await expect(detail.getByTestId("detail-reconciliation")).toHaveText("Matched");
    await expectAmountsWrapped(daniel, "the books' payment drawer");
    await detail.getByRole("button", { name: "Close" }).click();
    await daniel.getByLabel("Search the ledger").fill("");
    // AC-11.4: the export of the rows shown, made in the tab, with its event in the access log.
    const downloading = daniel.waitForEvent("download");
    await daniel.getByTestId("export-csv").click();
    const download = await downloading;
    const exported = (await readFile((await download.path()) as string, "utf8")).split("\r\n");
    expect(exported[0]).toBe(
      "date,counterparty,memo,category,amount,currency,type,reconciliation,transaction",
    );
    expect(
      exported
        .slice(1, -1)
        .map((line) => line.split(",")[4])
        .sort(),
    ).toEqual([FIRST.amount, LINE.amount, LATER.amount].sort());
    await expect(daniel.getByTestId("export-result")).toContainText(
      "Exported 3 rows to CSV in this tab. Grants Test Ltd sees the export in its access log.",
    );
    // The search text and every amount stayed in the accountant's tab.
    const booksSent = booksTraffic.join("\n");
    for (const plaintext of [FIRST, LINE, LATER].flatMap((value) => [
      value.amount,
      value.base,
      value.memo,
    ])) {
      expect(booksSent).not.toContain(plaintext);
    }

    // AC-10.4: revoking leaves the accountant's fetch empty.
    await go(page, "Viewing keys");
    await row.getByTestId("key-toggle").click();
    await expect(row.getByTestId("revoke-confirm")).toContainText(
      "Revoking stops access from now on. It cannot erase what was already viewed.",
    );
    await row.getByTestId("confirm-revoke").click();
    await expect(row).toHaveAttribute("data-status", "revoked");
    expect(await readRecords(daniel, orgId, danielKeys)).toEqual([]);
    await daniel.reload();
    await expect(daniel.getByTestId("books-unavailable")).toHaveText(
      "You hold no active viewing key for this organization",
    );
    await daniel.context().close();

    // AC-05.3: what the chain shows, from the indexed chain only; every transfer is sealed.
    await go(page, "Overview");
    await expect(page).toHaveURL(OVERVIEW_URL);
    await expect(async () => {
      await page.reload();
      await expect(page.locator('[data-testid="chain-row"][data-type="transfer_out"]')).toHaveCount(
        3,
        { timeout: 5_000 },
      );
    }).toPass({ timeout: 120_000 });
    for (const transfer of await page
      .locator('[data-testid="chain-row"][data-type="transfer_out"]')
      .all()) {
      await expect(transfer.getByTestId("chain-amount")).toHaveText("Sealed");
    }
    await expect(
      page
        .locator('[data-testid="chain-row"][data-type="deposit"]')
        .first()
        .getByTestId("chain-amount"),
    ).toHaveText("30 wUSDC");
    await expectAmountsWrapped(page, "overview with what the chain shows");

    // AC-10.5, AC-14.1: the events are logged, and no amount or memo is in the log or any request.
    const log = await page.request.get(`/api/orgs/${orgId}/access-log`);
    const { events } = (await log.json()) as { events: { action: string }[] };
    const actions = events.map((event) => event.action);
    for (const action of [
      "grant_created",
      "grant_accepted",
      "grant_activated",
      "grant_backfilled",
      "grant_revoked",
      "payment_executed",
      "payroll_executed",
      "disclosure_batch_created",
      "export_created",
      "reconciliation_updated",
    ]) {
      expect(actions).toContain(action);
    }
    const everything = [JSON.stringify(events), ...traffic].join("\n");
    for (const plaintext of [FIRST, LINE, LATER].flatMap((value) => [
      value.amount,
      value.base,
      value.memo,
    ])) {
      expect(everything).not.toContain(plaintext);
    }
    await go(page, "Viewing keys");
    await expect(
      page.locator('[data-testid="log-entry"][data-action="export_created"]'),
    ).toContainText("Daniel Osei exported 3 records to CSV");
    await expectAmountsWrapped(page, "viewing keys");
  });
});
