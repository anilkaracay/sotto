// F-06 in the browser on localnet (step 1.9): the owner pays a recipient confidentially with the
// injected test wallet (a version 0 transfer, its range proof staged in a record account), the
// worker's confirm-executions job settles it, both balances move by the amount onchain, and the self
// and recipient disclosures open with each viewer's viewing key under a manifest the owner signed
// (AC-06.1, AC-06.3, AC-06.4). A deny-listed wallet is blocked before anything is signed (AC-06.2).
// The amount is a sentinel that appears in no request, and neither does the memo (I-2). Step 1.10:
// the overview's recent activity opens the payment in the tab, the owner withdraws and unwraps from
// the overview's drawer, and the recipient reads the payment on the pay page, applies the pending
// balance, withdraws and unwraps (F-09, AC-09.1, version 0 transactions with the range proof in a
// record account). The accounts are prepared with the SDK; everything the owner and the recipient do
// runs in the browser. Runs in the localnet job of scripts/ci-local.sh against the bootstrapped
// validator, never devnet.
import { decryptTokenAccount } from "@sotto/sdk/confidential";
import {
  associatedTokenAccount,
  decodeToken2022Account,
  formatTokenAmount,
  readPublicTokenBalance,
} from "@sotto/sdk/confidential/public";
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
  ANY_APP_PAGE,
  approveOrg,
  clientAddress,
  expectAmountsWrapped,
  openSetup,
  OVERVIEW_URL,
  privacyScreenOn,
  signIn,
} from "../helpers.ts";

const bootstrap = readLocalnetBootstrap();
const rpc = createRetryingRpc(bootstrap.rpcUrl);
const PAY_URL = /\/app\/[0-9a-f-]{36}\/pay$/;
const OWNER = seededKeypair("sotto-e2e-payments-owner/v1");
const MAYA = seededKeypair("sotto-e2e-payments-recipient/v1");
const DENIED = seededKeypair("sotto-e2e-denied/v1");
const USDC = 1_000_000n;
/** I-2: a sentinel amount, never used for a deposit or a withdrawal. */
const SENTINEL = 12_345_678n;
const MEMO = "Invoice sentinel 4417";

async function chainOwner(keypair: number[], usdc: bigint): Promise<LocalnetOwner> {
  const signer = await createKeyPairSignerFromBytes(new Uint8Array(keypair));
  const funded = await fundLocalnetWallet(rpc, bootstrap, signer.address, { sol: 5n, usdc });
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

/** A wallet's public USDC balance read from chain; an account not created yet holds nothing. */
async function publicUsdcOf(who: LocalnetOwner): Promise<bigint> {
  const balance = await readPublicTokenBalance(rpc, who.usdc as Address);
  return balance.status === "present" ? balance.amount : 0n;
}

/** A wUSDC account's confidential balances, read from chain and decrypted with its owner's keys. */
async function balancesOf(who: LocalnetOwner) {
  const account = await fetchEncodedAccount(rpc, who.wusdc as Address, { commitment: "confirmed" });
  if (!account.exists) throw new Error("the account does not exist");
  return decryptTokenAccount(decodeToken2022Account(new Uint8Array(account.data)), who.keys);
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

/** Connects the wallet if needed and unlocks both keys with one click. */
async function unlock(page: Page) {
  const connect = page.getByRole("button", { name: "Connect" }).first();
  const signing = page.getByTestId("keys-wallet");
  await expect(connect.or(signing)).toBeVisible();
  if (await connect.isVisible()) await connect.click();
  await page.getByRole("button", { name: "Unlock with your wallet" }).click();
  await expect(page.getByTestId("viewing-unlocked")).toHaveText("Unlocked");
}

/** The caller's disclosures in the org, each checked against its manifest and opened. */
async function readDisclosures(
  page: Page,
  orgId: string,
  ownerWallet: string,
  viewer: { userId: string; keys: { publicKey: Uint8Array; secretKey: Uint8Array } },
) {
  const response = await page.request.get(`/api/orgs/${orgId}/disclosures`);
  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    items: { id: string; kind: string; ciphertext: string; manifestId: string }[];
    manifests: { id: string; manifest: unknown; signature: string; signerWallet: string }[];
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
        ownerWallet,
        org: orgId,
      }),
    ).toEqual({ ok: true });
    const ciphertext = new Uint8Array(Buffer.from(item.ciphertext, "base64"));
    expect(
      manifest.items.some((entry) => entry.id === item.id && entry.viewer === viewer.userId),
    ).toBe(true);
    opened.push(await openPayload(ciphertext, viewer.keys));
  }
  return opened;
}

// This spec's own client address for its main page (helpers.ts clientAddress).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.10" } });

test.describe.serial("single confidential payment on localnet", () => {
  let owner: LocalnetOwner;
  let maya: LocalnetOwner;
  let orgId = "";

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    owner = await chainOwner(OWNER.keypair, 100n);
    maya = await chainOwner(MAYA.keypair, 0n);
    const denied = await chainOwner(DENIED.keypair, 0n);
    // Set up once per ledger: a local rerun on the same validator finds the accounts in place.
    for (const who of [owner, maya, denied]) {
      const account = await fetchEncodedAccount(rpc, who.wusdc as Address, {
        commitment: "confirmed",
      });
      if (!account.exists) await setUpLocalnetAccount(rpc, who, bootstrap);
    }
    await fundLocalnetAccount(rpc, owner, bootstrap, 50n * USDC);
    await applyLocalnetPending(rpc, owner);
  });

  test("AC-06.1 AC-06.2 AC-06.3 AC-06.4 blocks a deny-listed wallet, then pays a ready recipient confidentially and discloses it to both", async ({
    page,
    browser,
  }) => {
    test.setTimeout(360_000);
    await signIn(page, OWNER.keypair);
    await page.getByLabel("Legal name").fill("Payments Test Ltd");
    await page.getByLabel("Country").selectOption("DE");
    await page.getByLabel("Registration number").fill("HRB 19");
    await page.getByLabel("Website").fill("payments.example");
    await page.getByLabel("Contact email").fill("ops@payments.example");
    await page.getByRole("button", { name: "Send for review" }).click();
    await expect(page.getByTestId("org-status")).toHaveText("In review");
    const admin = await newPage(browser);
    await signIn(admin, e2eKeypair(), ANY_APP_PAGE);
    await approveOrg(admin, "Payments Test Ltd");
    await admin.context().close();

    // The owner unlocks once and registers the viewing key (one signature, the tab holds the key).
    await page.goto("/app");
    await expect(page).toHaveURL(OVERVIEW_URL);
    orgId = OVERVIEW_URL.exec(new URL(page.url()).pathname)?.[1] ?? "";
    await openSetup(page);
    await unlock(page);
    await page.getByRole("button", { name: "Register public viewing key" }).click();
    await expect(page.getByTestId("viewing-key-status")).toHaveText("Registered");

    // Two recipients whose accounts are ready; Maya joins through her invite.
    await page.getByRole("link", { name: "Recipients" }).click();
    const form = page.getByTestId("add-recipient-card");
    for (const [name, wallet] of [
      ["Maya Chen", MAYA.address],
      ["Blocked Vendor", DENIED.address],
    ] as const) {
      await form.getByLabel("Name").fill(name);
      await form.getByLabel("Solana wallet address").fill(wallet);
      await form.getByRole("button", { name: "Add recipient" }).click();
      await expect(
        page
          .locator(`[data-testid="recipient-row"][data-wallet="${wallet}"]`)
          .getByTestId("recipient-readiness"),
      ).toHaveAttribute("data-readiness", "ready");
    }
    await page
      .locator(`[data-testid="recipient-row"][data-wallet="${MAYA.address}"]`)
      .getByRole("button", { name: "Invite link" })
      .click();
    const inviteLink = await page.getByTestId("invite-link").inputValue();
    const recipient = await newPage(browser);
    await addTestWallet(recipient, MAYA.keypair);
    await recipient.goto(new URL(inviteLink).pathname);
    await recipient.getByTestId("invite-sign-in").click();
    const option = recipient.getByTestId("wallet-option").filter({ hasText: "Sotto Test Wallet" });
    await option.getByRole("button", { name: "Connect" }).click();
    await option.getByRole("button", { name: "Sign in" }).click();
    await recipient.getByRole("button", { name: "Accept invite" }).click();
    await unlock(recipient);
    await recipient.getByRole("button", { name: "Register public viewing key" }).click();
    await expect(recipient.getByTestId("viewing-key-status")).toHaveText("Registered");
    await recipient.context().close();

    // AC-06.2: the deny-listed wallet is blocked before anything is signed.
    await page.getByRole("link", { name: "Payments" }).click();
    await expect(page).toHaveURL(/\/payments\/new$/);
    const pay = page.getByTestId("pay-card");
    const signedBefore = await page.evaluate(
      () =>
        (window as unknown as { __sottoTestWallet: { signedTransactions: number } })
          .__sottoTestWallet.signedTransactions,
    );
    expect(typeof signedBefore).toBe("number");
    await pay.getByLabel("Recipient").selectOption({
      label: `Blocked Vendor · ${DENIED.address.slice(0, 4)}…${DENIED.address.slice(-4)}`,
    });
    await pay.getByLabel("Amount (USDC)").fill("1");
    await pay.getByRole("button", { name: "Pay" }).click();
    await expect(page.getByTestId("payment-problem")).toHaveText(
      "The recipient's wallet is on the screening list, so the payment is blocked",
    );
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { __sottoTestWallet: { signedTransactions: number } })
            .__sottoTestWallet.signedTransactions,
      ),
    ).toBe(signedBefore);

    // The payment, with every request watched for the amount and the memo (I-2).
    const traffic: string[] = [];
    page.on("request", (request) => {
      traffic.push(request.url());
      traffic.push(request.postData() ?? "");
    });
    const before = await balancesOf(owner);
    const recipientBefore = await balancesOf(maya);
    await pay
      .getByLabel("Recipient")
      .selectOption({ label: `Maya Chen · ${MAYA.address.slice(0, 4)}…${MAYA.address.slice(-4)}` });
    await pay.getByLabel("Amount (USDC)").fill("12.345678");
    await pay.getByLabel("Memo").fill(MEMO);
    await pay.getByLabel("Category").selectOption("supplier");
    await pay.getByRole("button", { name: "Pay" }).click();
    await expect(page.getByTestId("payment-progress")).toContainText("of");
    await expect(page.getByTestId("payment-done")).toContainText(
      "Paid 12.345678 USDC to Maya Chen. Settled onchain",
      { timeout: 180_000 },
    );
    await expect(page.getByTestId("payment-done")).toContainText(
      "The payment record is saved, encrypted for you and Maya Chen.",
    );
    const everything = traffic.join("\n");
    for (const plaintext of [SENTINEL.toString(), "12.345678", MEMO]) {
      expect(everything).not.toContain(plaintext);
    }

    // Onchain: the sender's available balance down by the amount, the recipient's pending up by it.
    const after = await balancesOf(owner);
    expect(after.available).toBe(before.available - SENTINEL);
    const received = await balancesOf(maya);
    expect(received.pending).toBe(recipientBefore.pending + SENTINEL);

    // The recent payments table: settled, the amount opened in this tab with the viewing key.
    const row = page.getByTestId("payment-row").first();
    await expect(row).toHaveAttribute("data-status", "settled");
    await expect(row.getByTestId("payment-amount")).toHaveText("12.345678 USDC");
    // AC-15.1: with the privacy screen on, every amount on the page is inside Amount.
    await expectAmountsWrapped(page, "payments");

    // AC-06.4: the owner's self disclosure and the recipient's, under the owner's manifest.
    const me = (await (await page.request.get("/api/me")).json()) as { user: { id: string } };
    const mine = await readDisclosures(page, orgId, OWNER.address, {
      userId: me.user.id,
      keys: await viewingKeyOf(OWNER.keypair),
    });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      kind: "payment",
      direction: "out",
      category: "supplier",
      amount: SENTINEL.toString(),
      memo: MEMO,
      counterparty: "Maya Chen",
    });
    const reader = await newPage(browser);
    // Any app page but the sign in screen: sign in has completed.
    await signIn(reader, MAYA.keypair, /\/app(?!\/sign-in)(\/.*)?$/);
    const mayaMe = (await (await reader.request.get("/api/me")).json()) as {
      user: { id: string };
    };
    const theirs = await readDisclosures(reader, orgId, OWNER.address, {
      userId: mayaMe.user.id,
      keys: await viewingKeyOf(MAYA.keypair),
    });
    expect(theirs).toHaveLength(1);
    expect(theirs[0]).toMatchObject({ amount: SENTINEL.toString(), subject: mine[0]?.subject });
    await reader.context().close();

    // Step 1.10: the overview's recent activity opens the payment in this tab (the keys stay open
    // across the tab's pages).
    await page.getByRole("navigation").getByRole("link", { name: "Overview" }).click();
    await expect(page).toHaveURL(OVERVIEW_URL);
    const activity = page.getByTestId("activity-row").first();
    await expect(activity).toHaveAttribute("data-status", "settled");
    await expect(activity.getByTestId("activity-amount")).toHaveText("12.345678 USDC");
    await expect(activity).toContainText(MEMO);
    await expect(activity).toContainText("Supplier");
    await expectAmountsWrapped(page, "overview");
  });

  test("AC-09.1 withdraws and unwraps from the overview's drawer and from the recipient's pay page", async ({
    page,
    browser,
  }) => {
    test.setTimeout(480_000);
    // The owner: the overview's Withdraw drawer, 2 wUSDC withdrawn and unwrapped to USDC.
    await signIn(page, OWNER.keypair, OVERVIEW_URL);
    await expect(page.getByTestId("account-sky")).toHaveAttribute("data-state", "set_up");
    await expect(page.getByTestId("account-address")).toHaveText(
      `${owner.wusdc.slice(0, 4)} •••• ${owner.wusdc.slice(-4)}`,
    );
    await unlock(page);
    const ownerBefore = await balancesOf(owner);
    const ownerUsdcBefore = await publicUsdcOf(owner);
    // AC-15.1: the privacy screen is on before the drawer opens (the drawer makes the rest inert).
    await privacyScreenOn(page);
    await page.getByTestId("open-withdraw").click();
    const drawer = page.getByRole("dialog", { name: "Withdraw" });
    await drawer.getByLabel("Amount of wUSDC").fill("2");
    await drawer.getByRole("button", { name: "Withdraw and unwrap" }).click();
    await expect(drawer.getByTestId("withdraw-done")).toContainText(
      "Withdrew 2 wUSDC and unwrapped it to 2 USDC",
      { timeout: 180_000 },
    );
    const ownerAfter = await balancesOf(owner);
    expect(ownerAfter.available).toBe(ownerBefore.available + ownerBefore.pending - 2n * USDC);
    expect(await publicUsdcOf(owner)).toBe(ownerUsdcBefore + 2n * USDC);
    await expectAmountsWrapped(page, "the overview's withdraw drawer");

    // The recipient: /app opens the pay page; the payment opens with the viewing key in the tab.
    const recipient = await newPage(browser);
    await signIn(recipient, MAYA.keypair, PAY_URL);
    await expect(recipient.getByTestId("received-locked")).toContainText(
      "sealed to your viewing key",
    );
    await unlock(recipient);
    const received = recipient.getByTestId("received-row").first();
    await expect(received).toHaveAttribute("data-state", "opened");
    await expect(received.getByTestId("received-amount")).toHaveText("12.345678 USDC");
    await expect(received).toContainText(MEMO);

    // The pending balance is applied, then 5 wUSDC withdrawn and unwrapped.
    const mayaBefore = await balancesOf(maya);
    const mayaUsdcBefore = await publicUsdcOf(maya);
    expect(mayaBefore.pending).toBeGreaterThanOrEqual(SENTINEL);
    await recipient.getByRole("button", { name: "Apply pending balance" }).click();
    await expect(recipient.getByTestId("apply-done")).toContainText(
      "Applied your pending balance to your available balance.",
      { timeout: 120_000 },
    );
    const card = recipient.getByTestId("withdraw-card");
    await card.getByLabel("Amount of wUSDC").fill("5");
    await card.getByRole("button", { name: "Withdraw and unwrap" }).click();
    await expect(card.getByTestId("withdraw-done")).toContainText(
      "Withdrew 5 wUSDC and unwrapped it to 5 USDC",
      { timeout: 180_000 },
    );
    const mayaAfter = await balancesOf(maya);
    expect(mayaAfter.pending).toBe(0n);
    expect(mayaAfter.available).toBe(mayaBefore.available + mayaBefore.pending - 5n * USDC);
    expect(await publicUsdcOf(maya)).toBe(mayaUsdcBefore + 5n * USDC);
    await expectAmountsWrapped(recipient, "my pay after a withdrawal");
    await recipient.context().close();
  });

  // Step 4.11 (D-38): a payment that cannot go on says what happened and why, and is fixed where it
  // stands, with the form's values kept: the keys locked in the tab, the confidential balance below
  // the amount (the balances shown, the missing part prefilled and moved from the public balance),
  // and a request the wallet rejects (nothing sent, the same payment again with "Try again"). The
  // blocks' words, one by one, are in apps/web/test/pay-guides.test.tsx.
  test("step 4.11: a blocked payment is fixed in place and the form keeps its values", async ({
    page,
  }) => {
    test.setTimeout(480_000);
    await signIn(page, OWNER.keypair, OVERVIEW_URL);
    await page.getByRole("link", { name: "Payments" }).click();
    await expect(page).toHaveURL(/\/payments\/new$/);
    const pay = page.getByTestId("pay-card");
    const mayaLabel = `Maya Chen · ${MAYA.address.slice(0, 4)}…${MAYA.address.slice(-4)}`;
    const NOTE = "Guided retry 4.11";
    const expectForm = async (amount: string) => {
      await expect(pay.getByLabel("Recipient").locator("option:checked")).toHaveText(mayaLabel);
      await expect(pay.getByLabel("Amount (USDC)")).toHaveValue(amount);
      await expect(pay.getByLabel("Memo")).toHaveValue(NOTE);
    };
    const signed = () =>
      page.evaluate(
        () =>
          (window as unknown as { __sottoTestWallet: { signedTransactions: number } })
            .__sottoTestWallet.signedTransactions,
      );

    // The keys are locked in a new tab: the form says so and unlocks them in place.
    const before = await balancesOf(owner);
    const publicBefore = await publicUsdcOf(owner);
    expect(before.pending).toBe(0n);
    // 10 USDC more than the confidential balance holds, and less than the wallet holds in public.
    const need = before.available + 10n * USDC;
    expect(publicBefore).toBeGreaterThanOrEqual(10n * USDC);
    const shown = (base: bigint) => formatTokenAmount(base, 6);
    const amount = shown(need);
    await pay.getByLabel("Recipient").selectOption({ label: mayaLabel });
    await pay.getByLabel("Amount (USDC)").fill(amount);
    await pay.getByLabel("Memo").fill(NOTE);
    const locked = page.getByTestId("guidance-locked");
    await expect(locked).toContainText("Your keys are locked in this tab.");
    await expect(locked).toContainText("The proofs of a confidential payment are made in this tab");
    await expect(pay.getByRole("button", { name: "Pay", exact: true })).toBeDisabled();
    const connect = page.getByRole("button", { name: "Connect" }).first();
    if (await connect.isVisible()) await connect.click();
    await locked.getByRole("button", { name: "Unlock my keys" }).click();
    await expect(locked).toHaveCount(0);
    await expect(page.getByTestId("viewing-unlocked")).toHaveText("Unlocked");
    await expectForm(amount);

    // The confidential balance is below the amount: found before anything is created or signed.
    const rows = await page.getByTestId("payment-row").count();
    const signedBefore = await signed();
    await pay.getByRole("button", { name: "Pay", exact: true }).click();
    const low = page.getByTestId("guidance-insufficient");
    await expect(low).toContainText(
      `Your confidential balance does not cover ${amount} USDC. Nothing was sent.`,
    );
    await expect(low).toContainText(
      "A confidential payment is paid from the available confidential balance only.",
    );
    await expect(low.getByTestId("guidance-balances").getByRole("listitem")).toHaveText([
      `Available, confidential: ${shown(before.available)} wUSDC`,
      "Pending, confidential: 0 wUSDC",
      `Public, in your wallet: ${shown(publicBefore)} USDC`,
    ]);
    await expect(low.getByTestId("guidance-move-amount")).toHaveValue("10");
    await expect(low).toContainText("Your wallet will ask 2 times");
    expect(await signed()).toBe(signedBefore);
    await expect(page.getByTestId("payment-row")).toHaveCount(rows);
    await expect(page.getByTestId("payment-problem")).toHaveCount(0);
    // AC-15.1: every number of the block is under the privacy screen.
    await expectAmountsWrapped(page, "payments with the balance block");

    // The fix in place: the missing 10 USDC wrapped, deposited and applied, in two transactions.
    await low.getByRole("button", { name: "Move USDC to confidential balance" }).click();
    await expect(low).toHaveCount(0, { timeout: 180_000 });
    expect(await signed()).toBe(signedBefore + 2);
    const moved = await balancesOf(owner);
    expect(moved.available).toBe(need);
    expect(moved.pending).toBe(0n);
    expect(await publicUsdcOf(owner)).toBe(publicBefore - 10n * USDC);
    await expectForm(amount);

    // The wallet rejects the request: nothing is sent, the form is kept, and the block says so.
    await page.evaluate(() =>
      (
        window as unknown as {
          __sottoTestWallet: { refuseTransactions: (refusal: object | null) => void };
        }
      ).__sottoTestWallet.refuseTransactions({
        name: "WalletSignTransactionError",
        message: "User rejected the request.",
      }),
    );
    await pay.getByRole("button", { name: "Pay", exact: true }).click();
    const refused = page.getByTestId("guidance-wallet");
    await expect(refused).toContainText("You cancelled in your wallet. Nothing was sent.", {
      timeout: 120_000,
    });
    await expect(refused).toContainText("Sotto Test Wallet said");
    await expect(refused).toContainText("Your form is kept.");
    // The devnet question belongs to devnet; this ledger is a local one.
    await expect(refused).not.toContainText("devnet");
    await expect(page.getByTestId("payment-problem")).toHaveCount(0);
    await expectForm(amount);
    expect((await balancesOf(owner)).available).toBe(need);
    await expect(page.getByTestId("payment-row")).toHaveCount(rows + 1);

    // "Try again" runs the same payment again: one more row never appears, and it settles.
    await page.evaluate(() =>
      (
        window as unknown as {
          __sottoTestWallet: { refuseTransactions: (refusal: object | null) => void };
        }
      ).__sottoTestWallet.refuseTransactions(null),
    );
    await refused.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByTestId("payment-done")).toContainText(
      `Paid ${amount} USDC to Maya Chen. Settled onchain`,
      { timeout: 180_000 },
    );
    await expect(refused).toHaveCount(0);
    await expect(page.getByTestId("payment-row")).toHaveCount(rows + 1);
    await expect(page.getByTestId("payment-row").first()).toHaveAttribute("data-status", "settled");
    expect((await balancesOf(owner)).available).toBe(0n);
  });
});
