// F-03 and F-04 in the browser on localnet (step 1.7): the owner of an active org, with the injected
// test wallet, meets the determinism check, sets up the confidential wUSDC account and funds it through
// the UI; every balance on the page comes from chain state (AC-04.4) and matches what the owner's keys
// decrypt from chain here; nothing secret travels; a reload shows Locked until the owner unlocks again
// (AC-03.5), on the setup page and on the overview (AC-05.1). Runs in the localnet job of
// scripts/ci-local.sh against the bootstrapped validator, never devnet.
import { createPrivateKey, sign as ed25519Sign } from "node:crypto";
import { readConfidentialBalance } from "@sotto/sdk/confidential";
import { associatedTokenAccount } from "@sotto/sdk/confidential/public";
import { confidentialKeysMessage, deriveStandardKeys } from "@sotto/sdk/keys";
import { randomizedEd25519Signature } from "@sotto/sdk/testing";
import { fundLocalnetWallet, readLocalnetBootstrap } from "@sotto/sdk/testing/localnet";
import { createRetryingRpc } from "@sotto/sdk/tx";
import { address, getBase58Decoder } from "@solana/kit";
import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN_WALLET, E2E_KEYPAIR_SEED, e2eKeypair } from "../fixtures.ts";
import { signIn } from "../helpers.ts";

const bootstrap = readLocalnetBootstrap();
const rpc = createRetryingRpc(bootstrap.rpcUrl);
const SETUP_URL = /\/app\/[0-9a-f-]{36}\/setup$/;

const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), E2E_KEYPAIR_SEED]),
  format: "der",
  type: "pkcs8",
});
const keySignature = new Uint8Array(ed25519Sign(null, confidentialKeysMessage(), privateKey));

type TestWallet = { queueSignatures: (signatures: string[]) => void; signedTransactions: number };

const signedTransactions = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __sottoTestWallet: TestWallet }).__sottoTestWallet.signedTransactions,
  );

const value = (page: Page, card: string) => page.getByTestId(`${card}-value`);

/** Connects the wallet if this page load has not yet (after sign in it still has), then unlocks. */
async function unlock(page: Page) {
  const connect = page.getByRole("button", { name: "Connect" });
  const signing = page.getByTestId("keys-wallet");
  await expect(connect.or(signing)).toBeVisible();
  if (await connect.isVisible()) await connect.click();
  await expect(signing).toContainText("EQMW…RLZC");
  await page.getByRole("button", { name: "Unlock with your wallet" }).click();
  await expect(page.getByTestId("keys-status")).toHaveText("Unlocked");
}

test.describe.serial("confidential account on localnet", () => {
  test.beforeAll(async () => {
    await fundLocalnetWallet(rpc, bootstrap, address(E2E_ADMIN_WALLET), { sol: 10n, usdc: 100n });
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

    await page.goto("/app");
    await expect(page).toHaveURL(SETUP_URL);
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
    // Nothing was configured: no transaction, and the account does not exist onchain.
    expect(await signedTransactions(page)).toBe(0);
    const token = await associatedTokenAccount(
      address(E2E_ADMIN_WALLET),
      bootstrap.wrappedUsdcMint,
    );
    expect((await rpc.getAccountInfo(token, { encoding: "base64" }).send()).value).toBeNull();
    await expect(page.getByTestId("account-status")).toHaveText("Not set up");
  });

  test("AC-03.1 AC-03.3 AC-03.4 AC-04.1 AC-04.2 AC-04.3 AC-04.4 sets up and funds the account with the wallet, every balance from chain", async ({
    page,
  }) => {
    const wallet = await signIn(page, e2eKeypair(), SETUP_URL);
    const traffic: string[] = [];
    page.on("request", (request) => {
      traffic.push(`${request.method()} ${request.url()} ${JSON.stringify(request.headers())}`);
      traffic.push(request.postData() ?? "");
    });
    await unlock(page);
    await expect(value(page, "balance-public-usdc")).toHaveText("100 USDC");
    await expect(value(page, "balance-public-wusdc")).toHaveText("No account yet");
    await expect(value(page, "balance-available")).toHaveText("Not set up yet");

    // AC-03.3: the second signature matches, one transaction sets the account up, Sotto records it.
    await page.getByRole("button", { name: "Set up the account" }).click();
    await expect(page.getByTestId("account-status")).toHaveText("Set up");
    await expect(page.getByTestId("account-recorded")).toHaveText("Recorded");
    const token = await associatedTokenAccount(address(wallet), bootstrap.wrappedUsdcMint);
    await expect(page.getByTestId("token-account")).toHaveText(token);
    // AC-03.4: public, pending (decrypted) and available (decrypted) after setup.
    await expect(value(page, "balance-available")).toHaveText("0 wUSDC");
    await expect(value(page, "balance-pending")).toHaveText("0 wUSDC");
    await expect(value(page, "balance-public-wusdc")).toHaveText("0 wUSDC");

    const funding = page.getByTestId("funding-card");
    // AC-04.1: wrap 25 USDC.
    await page.getByLabel("Amount").fill("25");
    await funding.getByRole("button", { name: "Wrap USDC" }).click();
    await expect(funding.getByTestId("step-done")).toContainText(
      "Wrapped 25 USDC into public wUSDC.",
    );
    await expect(value(page, "balance-public-usdc")).toHaveText("75 USDC");
    await expect(value(page, "balance-public-wusdc")).toHaveText("25 wUSDC");
    // AC-04.2: deposit 10 wUSDC into the pending balance.
    await page.getByLabel("Amount").fill("10");
    await funding.getByRole("button", { name: "Deposit to confidential" }).click();
    await expect(funding.getByTestId("step-done")).toContainText("Deposited 10 wUSDC");
    await expect(value(page, "balance-public-wusdc")).toHaveText("15 wUSDC");
    await expect(value(page, "balance-pending")).toHaveText("10 wUSDC");
    await expect(value(page, "balance-available")).toHaveText("0 wUSDC");
    // AC-04.3: apply the pending balance.
    await funding.getByRole("button", { name: "Apply pending balance" }).click();
    await expect(funding.getByTestId("step-done")).toContainText("Applied your pending balance");
    await expect(value(page, "balance-pending")).toHaveText("0 wUSDC");
    await expect(value(page, "balance-available")).toHaveText("10 wUSDC");

    // AC-04.4: the page shows what the chain holds, decrypted here with the owner's keys.
    const keys = await deriveStandardKeys(address(wallet), keySignature);
    const chain = await readConfidentialBalance({ rpc, token, owner: address(wallet), keys });
    expect(chain).toMatchObject({ available: 10_000_000n, pending: 0n });
    expect(await signedTransactions(page)).toBe(4);

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

  test("AC-03.5 AC-05.1 shows the confidential balance as Locked after a reload until the owner unlocks, on setup and the overview", async ({
    page,
  }) => {
    await signIn(page, e2eKeypair(), SETUP_URL);
    for (const pass of ["first load", "reload"]) {
      if (pass === "reload") await page.reload();
      await expect(page.getByTestId("keys-status")).toHaveText("Locked");
      for (const card of ["balance-available", "balance-pending"]) {
        await expect(page.getByTestId(card)).toHaveAttribute("data-state", "locked");
        await expect(value(page, card)).toHaveText("Unlock to see");
      }
      // Public balances need no keys.
      await expect(value(page, "balance-public-wusdc")).toHaveText("15 wUSDC");
      await expect(value(page, "balance-public-usdc")).toHaveText("75 USDC");
    }
    await unlock(page);
    await expect(value(page, "balance-available")).toHaveText("10 wUSDC");
    await expect(value(page, "balance-pending")).toHaveText("0 wUSDC");

    // AC-05.1: the overview's balance cards, Locked until this page unlocks too.
    await page.getByRole("link", { name: "Overview" }).click();
    await expect(page).toHaveURL(/\/app\/[0-9a-f-]{36}\/overview$/);
    await expect(page.getByTestId("balance-available")).toHaveAttribute("data-state", "locked");
    await expect(value(page, "balance-public-wusdc")).toHaveText("15 wUSDC");
    await unlock(page);
    await expect(value(page, "balance-available")).toHaveText("10 wUSDC");
    await expect(value(page, "balance-pending")).toHaveText("0 wUSDC");
    await expect(value(page, "balance-public-usdc")).toHaveText("75 USDC");
    await expect(page.getByTestId("balance-available").getByTestId("wrap-label")).toHaveText(
      "devnet test wrap",
    );
  });
});
