// F-13 in the browser on localnet (step 2.8): the owner of an active organization, with 20 wUSDC
// available, first asks for "Balance is at least $100,000": the tab sees the balance is below it and
// shows Not proven, and nothing is sent, simulated or signed (AC-13.2). Then the owner proves at least
// $10 for "Harbor Bank": the proofs are made in the tab, verified into context accounts, the program
// writes the record, and every proof account is closed with its rent back to the owner (AC-13.1,
// AC-13.4); the certificate shows Proven and its link, and the issued list the record. A signed out
// browser opens /v/<address> and sees Proven, the organization's legal name from its SAS
// attestation, the statement, the slot and "Balance disclosed: none" (AC-13.3). Runs in the localnet
// job of scripts/ci-local.sh against the bootstrapped validator (sotto_proofs deployed per ledger),
// never devnet.
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
  address,
  createKeyPairSignerFromBytes,
  fetchEncodedAccount,
  getBase58Decoder,
  getAddressEncoder,
  signBytes,
  type Address,
} from "@solana/kit";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { e2eKeypair, seededKeypair } from "../fixtures.ts";
import { clientAddress, expectAmountsWrapped, OVERVIEW_URL, signIn } from "../helpers.ts";

const bootstrap = readLocalnetBootstrap();
const rpc = createRetryingRpc(bootstrap.rpcUrl);
const OWNER = seededKeypair("sotto-e2e-proofs-owner/v1");
const USDC = 1_000_000n;
const ZK_ELGAMAL_PROOF = "ZkE1Gama1Proof11111111111111111111111111111";
const RECORD_PROGRAM = "recr1L3PCGKLbckBqMNcJhuuyU1zgo8nBhfLVsJNwr5";

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

/** Proof accounts the owner still holds: ZK ElGamal contexts and SPL Record accounts it controls. */
async function openProofAccounts(owner: Address): Promise<number> {
  const bytes = getBase58Decoder().decode(getAddressEncoder().encode(owner));
  const [contexts, records] = await Promise.all([
    rpc
      .getProgramAccounts(address(ZK_ELGAMAL_PROOF), {
        commitment: "confirmed",
        encoding: "base64",
        filters: [{ memcmp: { offset: 0n, bytes: bytes as never, encoding: "base58" } }],
      })
      .send(),
    rpc
      .getProgramAccounts(address(RECORD_PROGRAM), {
        commitment: "confirmed",
        encoding: "base64",
        filters: [{ memcmp: { offset: 1n, bytes: bytes as never, encoding: "base58" } }],
      })
      .send(),
  ]);
  return contexts.length + records.length;
}

async function newPage(browser: Browser): Promise<Page> {
  const baseURL = test.info().project.use.baseURL;
  const context = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    extraHTTPHeaders: clientAddress(),
  });
  return context.newPage();
}

/** Connects the wallet if needed and unlocks the keys with one click. */
async function unlock(page: Page) {
  const connect = page.getByRole("button", { name: "Connect" });
  const signing = page.getByTestId("keys-wallet");
  await expect(connect.or(signing)).toBeVisible();
  if (await connect.isVisible()) await connect.click();
  await page.getByRole("button", { name: "Unlock with your wallet" }).click();
  await expect(page.getByTestId("keys-status")).toHaveText("Unlocked");
}

test.use({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.40" } });

test.describe.serial("proof of funds on localnet", () => {
  let owner: LocalnetOwner;

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    if (!bootstrap.sottoProofs) throw new Error("the bootstrap did not deploy sotto_proofs");
    owner = await chainOwner(OWNER.keypair, 100n);
    const account = await fetchEncodedAccount(rpc, owner.wusdc as Address, {
      commitment: "confirmed",
    });
    if (!account.exists) await setUpLocalnetAccount(rpc, owner, bootstrap);
    await fundLocalnetAccount(rpc, owner, bootstrap, 20n * USDC);
    await applyLocalnetPending(rpc, owner);
  });

  test("AC-13.1 AC-13.2 AC-13.3 AC-13.4 proves at least $10 and shows Proven on the public page, and a threshold above the balance shows Not proven and sends nothing", async ({
    page,
    browser,
  }) => {
    test.setTimeout(360_000);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await signIn(page, OWNER.keypair);
    await page.getByLabel("Legal name").fill("Proofs Test Ltd");
    await page.getByLabel("Country").selectOption("NL");
    await page.getByLabel("Registration number").fill("KVK 28");
    await page.getByLabel("Website").fill("proofs.example");
    await page.getByLabel("Contact email").fill("ops@proofs.example");
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
    await page.getByRole("navigation").getByRole("link", { name: "Proofs" }).click();
    await expect(page.getByRole("heading", { name: "Prove it, without showing it" })).toBeVisible();
    await unlock(page);
    await expect(page.getByTestId("issued-proofs")).toContainText("No proof issued yet.");

    // Every RPC method the page calls, to show that Not proven sends and signs nothing.
    const methods: string[] = [];
    page.on("request", (request) => {
      if (!request.url().endsWith("/api/rpc") || request.method() !== "POST") return;
      const body = request.postDataJSON() as { method?: string } | { method?: string }[];
      for (const call of Array.isArray(body) ? body : [body]) methods.push(call.method ?? "");
    });

    // AC-13.2: $100k against 20 wUSDC.
    const builder = page.getByTestId("proof-builder");
    await builder.getByRole("button", { name: "$100k" }).click();
    await builder.getByLabel("Share the answer with").fill("Northbank credit desk");
    await builder.getByRole("button", { name: "Generate proof" }).click();
    const certificate = page.getByTestId("certificate");
    await expect(certificate).toHaveAttribute("data-result", "not-proven", { timeout: 60_000 });
    await expect(page.getByTestId("certificate-result")).toHaveText("Not proven");
    await expect(certificate).toContainText(
      "This statement could not be proven. Nothing else was revealed.",
    );
    await expect(certificate).toContainText("Balance is at least $100,000");
    await expect(certificate.getByTestId("copy-link")).toHaveCount(0);
    expect(methods.filter((method) => /^(send|simulate)Transaction$/.test(method))).toEqual([]);
    expect(await openProofAccounts(owner.signer.address)).toBe(0);

    // AC-13.1 and AC-13.4: at least $10 for Harbor Bank, valid for 7 days.
    await builder.getByRole("button", { name: "Custom" }).click();
    await builder.getByLabel("Custom amount (US dollars)").fill("10");
    await builder.getByLabel("Share the answer with").fill("Harbor Bank");
    await builder.getByRole("button", { name: "7 days" }).click();
    await builder.getByRole("button", { name: "Generate another" }).click();
    await expect(certificate).toHaveAttribute("data-result", "proven", { timeout: 180_000 });
    await expect(page.getByTestId("certificate-result")).toHaveText("Proven");
    await expect(page.getByTestId("certificate-statement")).toHaveText("Balance is at least $10");
    await expect(certificate).toContainText(/Shared with\s*Harbor Bank/);
    await expect(certificate).toContainText(/Balance disclosed\s*None/);
    await expect(certificate).toContainText(/Sotto program on Solana, slot \d+/);
    // AC-15.1: with the privacy screen on, every amount on the page is inside Amount.
    await expectAmountsWrapped(page, "proofs");
    const href = await certificate
      .getByRole("link", { name: "Open the public page" })
      .getAttribute("href");
    const recordAddress = /^\/v\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(href ?? "")?.[1] ?? "";
    expect(recordAddress).not.toBe("");
    await certificate.getByTestId("copy-link").click();
    await expect(certificate.getByTestId("copy-link")).toHaveText("Link copied");
    const origin = new URL(page.url()).origin;
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      `${origin}/v/${recordAddress}`,
    );
    // Both contexts and the range proof's record account are closed, the rent back to the owner.
    expect(await openProofAccounts(owner.signer.address)).toBe(0);
    const record = await fetchEncodedAccount(rpc, address(recordAddress), {
      commitment: "confirmed",
    });
    expect(record.exists && record.programAddress).toBe(bootstrap.sottoProofs?.programId);

    // The issued list, after the page reads it again.
    await page.reload();
    const row = page.getByTestId("issued-row");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("data-state", "valid");
    await expect(row).toContainText("Harbor Bank");
    await expect(row).toContainText("Balance is at least $10");
    await expect(row).toContainText("Proven");
    await expect(row).toContainText("Valid until");
    await expectAmountsWrapped(page, "proofs with the issued list");

    // AC-13.3: a signed out browser, nothing but the link.
    const visitor = await newPage(browser);
    await expect(async () => {
      await visitor.goto(`/v/${recordAddress}`);
      // The worker issues the attestation after the approval; the page reads it from chain.
      await expect(visitor.getByTestId("verify-organization")).toHaveText("Proofs Test Ltd, NL", {
        timeout: 2_000,
      });
    }).toPass({ timeout: 120_000 });
    await expect(visitor.getByTestId("verify-word")).toHaveText("Proven");
    await expect(visitor.getByTestId("verify-statement")).toHaveText("Balance is at least $10");
    await expect(visitor.getByTestId("verify-disclosed")).toHaveText("none");
    await expect(visitor.getByTestId("verify-result")).toContainText(/Slot \d+/);
    await expect(visitor.getByTestId("verify-result")).toContainText("Harbor Bank");
    await expect(visitor.getByTestId("verify-result")).toContainText("Valid until");
    await expect(visitor.getByText(/\b(True|False)\b/)).toHaveCount(0);
    expect((await visitor.context().cookies()).length).toBe(0);
    await visitor.context().close();
  });
});
