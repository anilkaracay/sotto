// F-03 and F-04 in the browser on localnet (steps 1.7 and 1.7.1): the owner of an active org, with the
// injected test wallet, meets the determinism check, sets up the confidential wUSDC account and funds it
// in two signatures (wrap and deposit in one transaction, then apply), deposits public wUSDC it already
// had on its own; every balance on the page comes from chain state (AC-04.4) and matches what the
// owner's keys decrypt from chain here; nothing secret travels. The keys serve every page of the tab
// without a new signature, and end on reload, the Lock button, sign out and a change of the wallet
// account, closing the crypto worker (AC-03.5, AC-05.1). Runs in the localnet job of
// scripts/ci-local.sh against the bootstrapped validator, never devnet.
import { createPrivateKey, sign as ed25519Sign } from "node:crypto";
import { readConfidentialBalance } from "@sotto/sdk/confidential";
import { associatedTokenAccount, readTokenAccountState } from "@sotto/sdk/confidential/public";
import { confidentialKeysMessage, deriveStandardKeys } from "@sotto/sdk/keys";
import { randomizedEd25519Signature } from "@sotto/sdk/testing";
import {
  fundLocalnetWallet,
  readLocalnetBootstrap,
  wrapLocalnetUsdcAs,
} from "@sotto/sdk/testing/localnet";
import { createRetryingRpc } from "@sotto/sdk/tx";
import { address, createKeyPairSignerFromBytes, getBase58Decoder } from "@solana/kit";
import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN_WALLET, E2E_KEYPAIR_SEED, e2eKeypair } from "../fixtures.ts";
import { openSetup, OVERVIEW_URL, signIn } from "../helpers.ts";

const bootstrap = readLocalnetBootstrap();
const rpc = createRetryingRpc(bootstrap.rpcUrl);

const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), E2E_KEYPAIR_SEED]),
  format: "der",
  type: "pkcs8",
});
const keySignature = new Uint8Array(ed25519Sign(null, confidentialKeysMessage(), privateKey));

type TestWallet = {
  queueSignatures: (signatures: string[]) => void;
  signedTransactions: number;
  signedMessages: string[];
  switchAccount: () => Promise<string>;
};

const testWallet = <T>(page: Page, key: "signedTransactions" | "signedMessages") =>
  page.evaluate(
    (name) => (window as unknown as { __sottoTestWallet: TestWallet }).__sottoTestWallet[name],
    key,
  ) as Promise<T>;

const value = (page: Page, card: string) => page.getByTestId(`${card}-value`);

/**
 * Connects the wallet if this page load has not yet (after sign in it still has), then unlocks: one
 * click, the confidential key signature and then the viewing key signature (step 1.8.1).
 */
async function unlock(page: Page) {
  const connect = page.getByRole("button", { name: "Connect" });
  const signing = page.getByTestId("keys-wallet");
  await expect(connect.or(signing)).toBeVisible();
  if (await connect.isVisible()) await connect.click();
  await expect(signing).toContainText("EQMW…RLZC");
  await page.getByRole("button", { name: "Unlock with your wallet" }).click();
  await expect(page.getByTestId("keys-status")).toHaveText("Unlocked");
  await expect(page.getByTestId("viewing-unlocked")).toHaveText("Unlocked");
}

/** Records every status text the funding card shows, to check the steps it went through. */
async function watchFundingStatus(page: Page) {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __fundingStatus: string[] }).__fundingStatus = seen;
    new MutationObserver(() => {
      for (const node of document.querySelectorAll(
        '[data-testid="funding-card"] [role="status"]',
      )) {
        const text = node.textContent ?? "";
        if (!seen.includes(text)) seen.push(text);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  return () =>
    page.evaluate(() => (window as unknown as { __fundingStatus: string[] }).__fundingStatus);
}

// This spec's own client address for its main page (helpers.ts clientAddress).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.12" } });

test.describe.serial("confidential account on localnet", () => {
  test.beforeAll(async () => {
    const owner = address(E2E_ADMIN_WALLET);
    await fundLocalnetWallet(rpc, bootstrap, owner, { sol: 10n, usdc: 100n });
    // 5 USDC already wrapped into public wUSDC before the owner uses Sotto, as tokens received
    // publicly would be; this also creates the wUSDC account without the confidential extension.
    const signer = await createKeyPairSignerFromBytes(new Uint8Array(e2eKeypair()));
    await wrapLocalnetUsdcAs(rpc, bootstrap, signer, 5_000_000n);
  });

  test("AC-03.3 refuses to set up the account when the wallet's key signature changes, and reports the wallet", async ({
    page,
  }) => {
    await signIn(page, e2eKeypair());
    await page.getByLabel("Legal name").fill("Localnet Setup Ltd");
    await page.getByLabel("Country").selectOption("NL");
    await page.getByLabel("Registration number").fill("KVK 1");
    await page.getByLabel("Website").fill("setup.example");
    await page.getByLabel("Contact email").fill("ops@setup.example");
    await page.getByRole("button", { name: "Send for review" }).click();
    await expect(page.getByTestId("org-status")).toHaveText("In review");
    await page.goto("/app/admin");
    await page.getByRole("button", { name: "Approve" }).click();
    await page.getByRole("button", { name: "Confirm approve" }).click();
    await expect(page.getByText("No organization is waiting for review.")).toBeVisible();

    // /app opens the overview (step 1.10); the account card sends a new owner to Account setup.
    await page.goto("/app");
    await expect(page).toHaveURL(OVERVIEW_URL);
    await expect(page.getByTestId("account-sky")).toHaveAttribute("data-state", "not_set_up");
    await expect(page.getByTestId("account-address")).toHaveText("Not set up yet");
    await openSetup(page);
    await expect(page.getByTestId("network-label")).toHaveText("Localnet");
    // AC-03.1: the startup verification found the bootstrapped wrapped mint; D-01 label.
    await expect(page.getByTestId("wrapped-mint-status")).toHaveText("Ready");
    await expect(page.getByTestId("wrapped-mint")).toHaveText(bootstrap.wrappedUsdcMint);
    await expect(page.getByTestId("wrapped-mint-card").getByTestId("wrap-label")).toHaveText(
      "devnet test wrap",
    );
    await unlock(page);
    await expect(page.getByTestId("account-status")).toHaveText("Not set up");

    // A wallet with randomized signatures: the second signature of the key message differs.
    const randomized = await randomizedEd25519Signature(
      E2E_KEYPAIR_SEED,
      confidentialKeysMessage(),
    );
    await page.evaluate(
      (signature) =>
        (window as unknown as { __sottoTestWallet: TestWallet }).__sottoTestWallet.queueSignatures([
          signature,
        ]),
      Buffer.from(randomized).toString("base64"),
    );
    const report = page.waitForRequest(
      (request) => request.url().endsWith("/api/wallet-reports") && request.method() === "POST",
    );
    await page.getByRole("button", { name: "Set up the account" }).click();
    await expect(page.getByTestId("account-problem")).toContainText(
      "Your wallet signed the key message twice and gave two different signatures.",
    );
    expect(JSON.parse((await report).postData() ?? "{}")).toMatchObject({
      kind: "signature_not_deterministic",
      wallet: { name: "Sotto Test Wallet", version: "1.0.0" },
    });
    // Nothing was configured: no transaction, and the account has no confidential extension.
    expect(await testWallet<number>(page, "signedTransactions")).toBe(0);
    const token = await associatedTokenAccount(
      address(E2E_ADMIN_WALLET),
      bootstrap.wrappedUsdcMint,
    );
    expect(await readTokenAccountState(rpc, token)).toMatchObject({
      status: "present",
      amount: 5_000_000n,
      confidential: null,
    });
    await expect(page.getByTestId("account-status")).toHaveText("Not set up");
  });

  test("AC-03.1 AC-03.3 AC-03.4 AC-04.1 AC-04.2 AC-04.3 AC-04.4 sets up and funds the account in two signatures, every balance from chain", async ({
    page,
  }) => {
    const wallet = await signIn(page, e2eKeypair(), OVERVIEW_URL);
    await openSetup(page);
    const traffic: string[] = [];
    page.on("request", (request) => {
      traffic.push(`${request.method()} ${request.url()} ${JSON.stringify(request.headers())}`);
      traffic.push(request.postData() ?? "");
    });
    await unlock(page);
    await expect(value(page, "balance-public-usdc")).toHaveText("95 USDC");
    await expect(value(page, "balance-public-wusdc")).toHaveText("5 wUSDC");
    await expect(value(page, "balance-available")).toHaveText("Not set up yet");

    // Q-15 (step 2.1): a wallet whose own security check blocks the setup; Sotto shows the neutral
    // capability message and the wallet's words, and nothing is sent.
    await page.evaluate(() =>
      (
        window as unknown as {
          __sottoTestWallet: { refuseTransactions: (refusal: unknown) => void };
        }
      ).__sottoTestWallet.refuseTransactions({
        name: "WalletSignTransactionError",
        message: "Unable to verify this transaction. It cannot be signed.",
      }),
    );
    await page.getByRole("button", { name: "Set up the account" }).click();
    await expect(page.getByTestId("account-card").getByRole("alert")).toContainText(
      "Your wallet's security check blocked this confidential account setup. Try another Solana wallet, or contact your wallet's support. Sotto Test Wallet said: \"WalletSignTransactionError: Unable to verify this transaction. It cannot be signed.\"",
    );
    await expect(page.getByTestId("account-status")).toHaveText("Not set up");
    expect(await testWallet<number>(page, "signedTransactions")).toBe(0);
    await page.evaluate(() =>
      (
        window as unknown as {
          __sottoTestWallet: { refuseTransactions: (refusal: unknown) => void };
        }
      ).__sottoTestWallet.refuseTransactions(null),
    );

    // AC-03.3: the second signature matches, one transaction configures the existing account, Sotto
    // records it.
    await page.getByRole("button", { name: "Set up the account" }).click();
    await expect(page.getByTestId("account-status")).toHaveText("Set up");
    await expect(page.getByTestId("account-recorded")).toHaveText("Recorded");
    const token = await associatedTokenAccount(address(wallet), bootstrap.wrappedUsdcMint);
    await expect(page.getByTestId("token-account")).toHaveText(token);
    // AC-03.4: public, pending (decrypted) and available (decrypted) after setup.
    await expect(value(page, "balance-available")).toHaveText("0 wUSDC");
    await expect(value(page, "balance-pending")).toHaveText("0 wUSDC");
    await expect(value(page, "balance-public-wusdc")).toHaveText("5 wUSDC");
    expect(await testWallet<number>(page, "signedTransactions")).toBe(1);

    // AC-04.1 to AC-04.3: fund 25 USDC in two signatures, step 1 wrap and deposit, step 2 apply.
    const funding = page.getByTestId("funding-card");
    const statuses = await watchFundingStatus(page);
    await page.getByLabel("Amount of USDC").fill("25");
    await funding.getByRole("button", { name: "Fund account" }).click();
    await expect(funding.getByTestId("step-done")).toContainText(
      "Funded 25 wUSDC in two steps: wrapped and deposited, then applied to your available balance.",
    );
    const seen = await statuses();
    expect(
      seen.some((text) => text.startsWith("Step 1 of 2: wrapping 25 USDC and depositing it")),
    ).toBe(true);
    expect(seen.some((text) => text.startsWith("Step 2 of 2: applying 25 wUSDC"))).toBe(true);
    await expect(funding.getByTestId("funding-split")).toHaveCount(0);
    expect(await testWallet<number>(page, "signedTransactions")).toBe(3);
    await expect(value(page, "balance-public-usdc")).toHaveText("70 USDC");
    await expect(value(page, "balance-public-wusdc")).toHaveText("5 wUSDC");
    await expect(value(page, "balance-pending")).toHaveText("0 wUSDC");
    await expect(value(page, "balance-available")).toHaveText("25 wUSDC");

    // AC-04.2 on its own: the public wUSDC the owner already had goes into the pending balance, then
    // the apply moves it to the available balance.
    await funding.getByRole("button", { name: "Deposit 5 public wUSDC" }).click();
    await expect(funding.getByTestId("step-done")).toContainText(
      "Deposited 5 public wUSDC into your pending balance.",
    );
    await expect(value(page, "balance-public-wusdc")).toHaveText("0 wUSDC");
    await expect(value(page, "balance-pending")).toHaveText("5 wUSDC");
    await funding.getByRole("button", { name: "Apply pending balance" }).click();
    await expect(funding.getByTestId("step-done")).toContainText("Applied your pending balance");
    await expect(value(page, "balance-pending")).toHaveText("0 wUSDC");
    await expect(value(page, "balance-available")).toHaveText("30 wUSDC");
    expect(await testWallet<number>(page, "signedTransactions")).toBe(5);

    // AC-04.4: the page shows what the chain holds, decrypted here with the owner's keys.
    const keys = await deriveStandardKeys(address(wallet), keySignature);
    const chain = await readConfidentialBalance({ rpc, token, owner: address(wallet), keys });
    expect(chain).toMatchObject({ available: 30_000_000n, pending: 0n });

    // No key signature or key in any request (I-2, 10 section 3); transactions carry public data.
    const everything = traffic.join("\n");
    expect(everything).toContain("/api/token-accounts");
    for (const secret of [keySignature, keys.elgamalSecretKey, keys.aeKey]) {
      for (const pattern of [
        Buffer.from(secret).toString("hex"),
        Buffer.from(secret).toString("base64"),
        getBase58Decoder().decode(secret),
      ]) {
        expect(everything).not.toContain(pattern);
      }
    }
  });

  test("AC-03.5 AC-05.1 keeps the keys across the tab's pages without a new signature, and ends them on reload, Lock, sign out and a wallet account change", async ({
    page,
  }) => {
    await signIn(page, e2eKeypair(), OVERVIEW_URL);
    await openSetup(page);
    for (const pass of ["first load", "reload"]) {
      if (pass === "reload") await page.reload();
      await expect(page.getByTestId("keys-status")).toHaveText("Locked");
      for (const card of ["balance-available", "balance-pending"]) {
        await expect(page.getByTestId(card)).toHaveAttribute("data-state", "locked");
        await expect(value(page, card)).toHaveText("Unlock to see");
      }
      // Public balances need no keys.
      await expect(value(page, "balance-public-wusdc")).toHaveText("0 wUSDC");
      await expect(value(page, "balance-public-usdc")).toHaveText("70 USDC");
    }
    expect(page.workers()).toHaveLength(0);
    await unlock(page);
    await expect(value(page, "balance-available")).toHaveText("30 wUSDC");
    expect(page.workers()).toHaveLength(1);
    const signatures = (await testWallet<string[]>(page, "signedMessages")).length;

    // In-app navigation keeps the keys: the overview decrypts without a new signature (AC-05.1).
    await page.getByRole("link", { name: "Overview" }).click();
    await expect(page).toHaveURL(OVERVIEW_URL);
    await expect(page.getByTestId("keys-status")).toHaveText("Unlocked");
    await expect(value(page, "balance-available")).toHaveText("30 wUSDC");
    await expect(value(page, "balance-pending")).toHaveText("0 wUSDC");
    await expect(value(page, "balance-public-usdc")).toHaveText("70 USDC");
    await expect(page.getByTestId("balance-available").getByTestId("wrap-label")).toHaveText(
      "devnet test wrap",
    );
    await openSetup(page);
    await expect(value(page, "balance-available")).toHaveText("30 wUSDC");
    expect((await testWallet<string[]>(page, "signedMessages")).length).toBe(signatures);
    expect(page.workers()).toHaveLength(1);

    // The Lock button ends the keys and the crypto worker.
    await page.getByRole("button", { name: "Lock" }).click();
    await expect(page.getByTestId("keys-status")).toHaveText("Locked");
    await expect.poll(() => page.workers().length).toBe(0);

    // Sign out ends them too, with no reload in between.
    await unlock(page);
    await expect.poll(() => page.workers().length).toBe(1);
    await page.getByRole("button", { name: "Account and organizations" }).click();
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/app\/sign-in$/);
    await expect.poll(() => page.workers().length).toBe(0);
    const option = page.getByTestId("wallet-option").filter({ hasText: "Sotto Test Wallet" });
    const connect = option.getByRole("button", { name: "Connect" });
    if (await connect.isVisible()) await connect.click();
    await option.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(OVERVIEW_URL);
    await expect(page.getByTestId("keys-status")).toHaveText("Locked");

    // A change of the wallet account ends them, and the page says why.
    await unlock(page);
    await expect.poll(() => page.workers().length).toBe(1);
    await page.evaluate(() =>
      (window as unknown as { __sottoTestWallet: TestWallet }).__sottoTestWallet.switchAccount(),
    );
    await expect(page.getByTestId("keys-status")).toHaveText("Locked");
    await expect(page.getByTestId("lock-note")).toHaveText(
      "The keys locked because your wallet switched accounts.",
    );
    await expect.poll(() => page.workers().length).toBe(0);
    await expect(page.getByTestId("balance-available")).toHaveAttribute("data-state", "locked");
  });
});
