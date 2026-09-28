// F-06 in the browser on localnet (step 1.9): the owner pays a recipient confidentially with the
// injected test wallet (a version 0 transfer, its range proof staged in a record account), the
// worker's confirm-executions job settles it, both balances move by the amount onchain, and the self
// and recipient disclosures open with each viewer's viewing key under a manifest the owner signed
// (AC-06.1, AC-06.3, AC-06.4). A deny-listed wallet is blocked before anything is signed (AC-06.2).
// The amount is a sentinel that appears in no request, and neither does the memo (I-2). The accounts
// are prepared with the SDK; everything the owner and the recipient do runs in the browser. Runs in
// the localnet job of scripts/ci-local.sh against the bootstrapped validator, never devnet.
import { decryptTokenAccount } from "@sotto/sdk/confidential";
import { associatedTokenAccount, decodeToken2022Account } from "@sotto/sdk/confidential/public";
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
import { addTestWallet, clientAddress, signIn } from "../helpers.ts";

const bootstrap = readLocalnetBootstrap();
const rpc = createRetryingRpc(bootstrap.rpcUrl);
const SETUP_URL = /\/app\/([0-9a-f-]{36})\/setup$/;
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
  const connect = page.getByRole("button", { name: "Connect" });
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
    await signIn(admin, e2eKeypair());
    await admin.goto("/app/admin");
    await admin.getByRole("button", { name: "Approve" }).click();
    await admin.getByRole("button", { name: "Confirm approve" }).click();
    await expect(admin.getByText("No organization is waiting for review.")).toBeVisible();
    await admin.context().close();

    // The owner unlocks once and registers the viewing key (one signature, the tab holds the key).
    await page.goto("/app");
    await expect(page).toHaveURL(SETUP_URL);
    const orgId = SETUP_URL.exec(new URL(page.url()).pathname)?.[1] ?? "";
    await unlock(page);
    await page.getByRole("button", { name: "Create viewing key" }).click();
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
    await recipient.getByRole("button", { name: "Create viewing key" }).click();
    await expect(recipient.getByTestId("viewing-key-status")).toHaveText("Registered");
    await recipient.context().close();

    // AC-06.2: the deny-listed wallet is blocked before anything is signed.
    await page.getByRole("link", { name: "Payments" }).click();
    await expect(page).toHaveURL(/\/payments\/new$/);
    const pay = page.getByTestId("pay-card");
    const signedBefore = await page.evaluate(
      () =>
        (window as unknown as { __sottoTestWallet: { signedTransactions: unknown[] } })
          .__sottoTestWallet.signedTransactions.length,
    );
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
          (window as unknown as { __sottoTestWallet: { signedTransactions: unknown[] } })
            .__sottoTestWallet.signedTransactions.length,
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
  });
});
