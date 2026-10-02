// The public proof page in every state (step 3.4.1, 13 A51): a certificate for a record the owner
// generated in the app (Proven, its organization attested, shared with Harbor Bank), a record of a
// wallet with no organization (Proven, "Not verified by Sotto"), a record that expired, then the same
// record closed by its owner, the paused proof program (set and put back by the bootstrap's admin
// key), an address where nothing was written, and an account that is not a record. Each at 1440 and
// 390, with no horizontal scroll and no console error, compared with its baseline and scanned with axe
// since step 3.10.1, saved to this test's output directory and,
// once the run passes, to .demo-shots/screens/<UTC time>-proof-page/ (git ignored), for the
// founder's approval. "Proofs are not available here" needs a network without the program and is
// covered by the component test. Runs in the localnet job of scripts/ci-local.sh, one spec at a time
// (workers: 1), so the pause reaches no other spec; never devnet. Named to run after the sharing
// screens (step 3.10.1): its organization would add a row to their admin console's baseline.
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { closeProofAccounts } from "@sotto/sdk/confidential";
import { associatedTokenAccount, decodeToken2022Account } from "@sotto/sdk/confidential/public";
import { confidentialKeysMessage, deriveStandardKeys } from "@sotto/sdk/keys";
import {
  counterpartyHash,
  findProofRecordPda,
  getCloseProofRecordInstruction,
  getSetPausedInstruction,
  getVerifyBalanceThresholdInstructionAsync,
  randomBytes16,
  recordNonce,
} from "@sotto/sdk/proofs";
import { balanceThresholdProofs } from "@sotto/sdk/proofs/plan";
import { keypairWallet } from "@sotto/sdk/testing";
import {
  applyLocalnetPending,
  fundLocalnetAccount,
  fundLocalnetWallet,
  readLocalnetBootstrap,
  setUpLocalnetAccount,
  type LocalnetOwner,
} from "@sotto/sdk/testing/localnet";
import { createRetryingRpc, fromPortableInstruction, sendWithWallet } from "@sotto/sdk/tx";
import {
  createKeyPairSignerFromBytes,
  fetchEncodedAccount,
  generateKeyPairSigner,
  signBytes,
  type Address,
  type KeyPairSigner,
  type SignatureBytes,
  type Transaction,
} from "@solana/kit";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectAccessible } from "../a11y.ts";
import { e2eKeypair, seededKeypair } from "../fixtures.ts";
import {
  ANY_APP_PAGE,
  approveOrg,
  clientAddress,
  openSetup,
  OVERVIEW_URL,
  signIn,
} from "../helpers.ts";
import { expectVisual } from "../visual.ts";

const bootstrap = readLocalnetBootstrap();
const rpc = createRetryingRpc(bootstrap.rpcUrl);
const LEGAL = "Northwind Proof Ltd";
const OWNER = seededKeypair(`sotto-e2e-proof-page-owner/${Date.now()}`);
const STRANGER = seededKeypair(`sotto-e2e-proof-page-stranger/${Date.now()}`);
const USDC = 1_000_000n;
const V1_WALLET = "window.__sottoTestWalletVersions = ['legacy', 0, 1];";
const DEMO_SHOTS = fileURLToPath(new URL("../../../.demo-shots/screens/", import.meta.url));

const shots: string[] = [];

async function newPage(browser: Browser, width = 1440): Promise<Page> {
  const baseURL = test.info().project.use.baseURL;
  const context = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    extraHTTPHeaders: clientAddress(),
    viewport: { width, height: 900 },
  });
  const page = await context.newPage();
  await page.addInitScript({ content: V1_WALLET });
  return page;
}

/** The public page of `address` at 1440 and 390, signed out, in the state `state`. */
async function shootProof(browser: Browser, address: string, state: string, name: string) {
  for (const width of [1440, 390]) {
    const visitor = await newPage(browser, width);
    const problems: string[] = [];
    visitor.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") problems.push(message.text());
    });
    await visitor.goto(`/v/${address}`);
    await expect(visitor.getByTestId("verify-result")).toHaveAttribute("data-state", state);
    expect(await visitor.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await visitor.evaluate(() => document.fonts.ready);
    await visitor.waitForTimeout(1200);
    const path = test.info().outputPath(`${name}-${width}.png`);
    await visitor.screenshot({ path, fullPage: true });
    shots.push(path);
    // Step 3.10.1: the approved state against its baseline, and no WCAG 2.1 A or AA violation.
    await expectVisual(visitor, `${name}-${width}`);
    await expectAccessible(visitor, `${name}-${width}`);
    expect(problems).toEqual([]);
    await visitor.context().close();
  }
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

function cosigner(signers: readonly KeyPairSigner[]) {
  return async (transaction: Transaction): Promise<Record<Address, SignatureBytes>> => {
    const signatures: Record<Address, SignatureBytes> = {};
    for (const signer of signers) {
      if (!(signer.address in transaction.signatures)) continue;
      const [signed] = await signer.signTransactions([
        transaction as Parameters<KeyPairSigner["signTransactions"]>[0][number],
      ]);
      const signature = signed?.[signer.address];
      if (signature) signatures[signer.address] = signature;
    }
    return signatures;
  };
}

/** The chain's unix time, which the program checks the expiry against. */
async function chainNow(): Promise<bigint> {
  const slot = await rpc.getSlot({ commitment: "confirmed" }).send();
  return BigInt((await rpc.getBlockTime(slot).send()) ?? 0n);
}

/** A record of at least `threshold` written with the SDK, as the proofs page writes one. */
async function writeRecord(owner: LocalnetOwner, threshold: bigint, expiry: bigint) {
  const program = bootstrap.sottoProofs?.programId;
  if (!program) throw new Error("sotto_proofs is not deployed on this ledger");
  const encoded = await fetchEncodedAccount(rpc, owner.wusdc as Address, {
    commitment: "confirmed",
  });
  if (!encoded.exists) throw new Error("the owner's wUSDC account does not exist");
  const proofs = await balanceThresholdProofs({
    owner: owner.signer.address,
    token: owner.wusdc as Address,
    tokenAccount: decodeToken2022Account(new Uint8Array(encoded.data)),
    mint: bootstrap.wrappedUsdcMint,
    decimals: bootstrap.usdcDecimals,
    threshold,
    keys: owner.keys,
    rent: (space) => rpc.getMinimumBalanceForRentExemption(space).send(),
  });
  const cosign = cosigner(proofs.signers);
  for (const transaction of proofs.transactions) {
    await sendWithWallet({
      rpc,
      wallet: owner.wallet,
      version: 0,
      instructions: transaction.instructions.map(fromPortableInstruction),
      cosign,
    });
  }
  const nonce = await recordNonce(owner.wusdc as Address, program);
  await sendWithWallet({
    rpc,
    wallet: owner.wallet,
    version: 1,
    instructions: [
      await getVerifyBalanceThresholdInstructionAsync(
        {
          owner: owner.signer,
          tokenAccount: owner.wusdc as Address,
          equalityContext: proofs.equalityContext,
          rangeContext: proofs.rangeContext,
          payer: owner.signer,
          threshold,
          nonce,
          expiry,
          counterpartyHash: await counterpartyHash(randomBytes16(), "Kinfolk Studio"),
        },
        { programAddress: program },
      ),
    ],
  });
  await closeProofAccounts({
    rpc,
    wallet: owner.wallet,
    version: 0,
    cleanup: proofs.cleanup,
    cosign,
  });
  const [record] = await findProofRecordPda(
    { tokenAccount: owner.wusdc as Address, nonce },
    { programAddress: program },
  );
  return record;
}

async function setPaused(paused: boolean) {
  const proofs = bootstrap.sottoProofs;
  if (!proofs) throw new Error("sotto_proofs is not deployed on this ledger");
  const admin = await createKeyPairSignerFromBytes(
    new Uint8Array(JSON.parse(await readFile(bootstrap.payer.keypair, "utf8")) as number[]),
  );
  await sendWithWallet({
    rpc,
    wallet: keypairWallet(admin),
    version: 0,
    instructions: [
      getSetPausedInstruction(
        { config: proofs.config, admin, paused },
        { programAddress: proofs.programId },
      ),
    ],
  });
}

test.use({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.17" } });

test("the public proof page in every state, for the design pass (13 A51)", async ({
  page,
  browser,
}) => {
  test.setTimeout(900_000);
  const owner = await chainPerson(OWNER.keypair, 100n);
  await setUpLocalnetAccount(rpc, owner, bootstrap);
  await fundLocalnetAccount(rpc, owner, bootstrap, 40n * USDC);
  await applyLocalnetPending(rpc, owner);

  // An attested organization proves at least $10 for Harbor Bank in the app.
  await page.addInitScript({ content: V1_WALLET });
  await signIn(page, OWNER.keypair);
  await page.getByLabel("Legal name").fill(LEGAL);
  await page.getByLabel("Country").selectOption("NL");
  await page.getByLabel("Registration number").fill("KVK 38");
  await page.getByLabel("Website").fill("proof.example");
  await page.getByLabel("Contact email").fill("ops@proof.example");
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(page.getByTestId("org-status")).toHaveText("In review");
  const admin = await newPage(browser);
  await signIn(admin, e2eKeypair(), ANY_APP_PAGE);
  await approveOrg(admin, LEGAL);
  await admin.context().close();
  await expect(async () => {
    await page.goto("/app/onboarding");
    await expect(page.getByTestId("attestation-address")).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 120_000 });
  await page.goto("/app");
  await expect(page).toHaveURL(OVERVIEW_URL);
  const orgId = OVERVIEW_URL.exec(new URL(page.url()).pathname)?.[1] ?? "";
  await openSetup(page);
  const connect = page.getByRole("button", { name: "Connect" });
  if (await connect.isVisible()) await connect.click();
  await page.getByRole("button", { name: "Unlock with your wallet" }).click();
  await expect(page.getByTestId("viewing-unlocked")).toHaveText("Unlocked");
  await page.getByRole("button", { name: "Create viewing key" }).click();
  await expect(page.getByTestId("viewing-key-status")).toHaveText("Registered");
  const recorded = await page.request.post("/api/token-accounts", {
    headers: { origin: new URL(page.url()).origin },
    data: { orgId, address: owner.wusdc, keyScheme: "standard_v1" },
  });
  expect([200, 201]).toContain(recorded.status());
  await page.getByRole("navigation").getByRole("link", { name: "Proofs", exact: true }).click();
  const builder = page.getByTestId("proof-builder");
  await builder.getByRole("button", { name: "Custom" }).click();
  await builder.getByLabel("Custom amount (US dollars)").fill("10");
  await builder.getByLabel("Share the answer with").fill("Harbor Bank");
  await builder.getByRole("button", { name: "Generate proof" }).click();
  const certificate = page.getByTestId("certificate");
  await expect(certificate).toHaveAttribute("data-result", "proven", { timeout: 180_000 });
  const href = await certificate
    .getByRole("link", { name: "Open the public page" })
    .getAttribute("href");
  const proven = /^\/v\/([1-9A-HJ-NP-Za-km-z]{32,44})$/.exec(href ?? "")?.[1] ?? "";
  expect(proven).not.toBe("");
  await page.context().close();
  await shootProof(browser, proven, "valid", "01-proof-proven");

  // A wallet with no organization: the statement holds, the organization is not verified.
  const stranger = await chainPerson(STRANGER.keypair, 10n);
  await setUpLocalnetAccount(rpc, stranger, bootstrap);
  await fundLocalnetAccount(rpc, stranger, bootstrap, 5n * USDC);
  await applyLocalnetPending(rpc, stranger);
  const unverified = await writeRecord(stranger, 2n * USDC, (await chainNow()) + 30n * 24n * 3600n);
  await shootProof(browser, unverified, "valid", "02-proof-not-verified-org");

  // A record that expired, then the same record closed by its owner.
  const expiry = (await chainNow()) + 20n;
  const short = await writeRecord(owner, 5n * USDC, expiry);
  while ((await chainNow()) <= expiry) await new Promise((resolve) => setTimeout(resolve, 500));
  await shootProof(browser, short, "expired", "03-proof-expired");
  const program = bootstrap.sottoProofs?.programId as Address;
  await sendWithWallet({
    rpc,
    wallet: owner.wallet,
    version: 1,
    instructions: [
      getCloseProofRecordInstruction(
        { proofRecord: short, owner: owner.signer },
        { programAddress: program },
      ),
    ],
  });
  await shootProof(browser, short, "closed", "04-proof-closed");

  // The paused program, put back at once.
  await setPaused(true);
  try {
    await shootProof(browser, proven, "paused", "05-proof-paused");
  } finally {
    await setPaused(false);
  }
  // Unpaused, the record is Proven again.
  const again = await newPage(browser);
  await again.goto(`/v/${proven}`);
  await expect(again.getByTestId("verify-result")).toHaveAttribute("data-state", "valid");
  await again.context().close();

  // Nothing written at an address, and an account that is not a record.
  const nowhere = await generateKeyPairSigner();
  await shootProof(browser, nowhere.address, "not_found", "06-proof-not-found");
  await shootProof(browser, bootstrap.wrappedUsdcMint, "not_a_record", "07-proof-not-a-record");

  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const folder = `${DEMO_SHOTS}${stamp}Z-proof-page`;
  await mkdir(folder, { recursive: true });
  for (const path of shots) await copyFile(path, `${folder}/${path.split("/").pop()}`);
  console.log(`screens: ${folder}`);
});
