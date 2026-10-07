// F-03 keys in the browser (step 1.5, 10 sections 2 and 3): the owner of an active org unlocks the
// confidential keys only with an explicit click; the crypto Web Worker derives the ElGamal key that the
// spl-token CLI configured for the same keypair; no signature or key leaves the worker for the network
// or storage (AC-03.2, I-2); the viewing key registers with a signature the browser can verify (I-8);
// after a reload the keys are Locked again (the Locked state for AC-03.5; balances come in step 1.7).
// Since step 1.10 it runs on the overview, where /app sends the owner: the Phase 1 happy path (sign in,
// connect wallet, see the overview).
import { createPrivateKey, sign as ed25519Sign } from "node:crypto";
import {
  confidentialKeysMessage,
  deriveStandardKeys,
  deriveViewingKey,
  viewKeyMessage,
} from "@sotto/sdk/keys";
import { verifyViewKeyRegistration } from "@sotto/sdk/keys/public";
import { address, getBase58Decoder } from "@solana/kit";
import { expect, test, type Page } from "@playwright/test";
import {
  E2E_ADMIN_WALLET,
  E2E_CLI_ELGAMAL_KEY,
  E2E_KEYPAIR_SEED,
  e2eKeypair,
} from "../fixtures.ts";
import { openSetup, signIn } from "../helpers.ts";

const privateKey = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), E2E_KEYPAIR_SEED]),
  format: "der",
  type: "pkcs8",
});
const signWithTestKey = (message: Uint8Array) =>
  new Uint8Array(ed25519Sign(null, message, privateKey));

/** Every encoding a secret could travel in: hex, base64 and base58. */
function encodings(bytes: Uint8Array): string[] {
  return [
    Buffer.from(bytes).toString("hex"),
    Buffer.from(bytes).toString("base64"),
    getBase58Decoder().decode(bytes),
  ];
}

async function setRefused(page: Page, texts: string[]): Promise<void> {
  await page.evaluate(
    (refuse) =>
      (
        window as unknown as { __sottoTestWallet: { refuse: (texts: string[]) => void } }
      ).__sottoTestWallet.refuse(refuse),
    texts,
  );
}

async function signedMessages(page: Page): Promise<string[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __sottoTestWallet: { signedMessages: string[] } }).__sottoTestWallet
        .signedMessages,
  );
}

test("AC-03.2 unlocks only after the click, derives the CLI's key in the worker and sends no key anywhere", async ({
  page,
  browser,
}) => {
  const wallet = await signIn(page, e2eKeypair());
  expect(wallet).toBe(E2E_ADMIN_WALLET);

  // An active org: create it, then approve it in the admin console (this wallet is an E2E admin).
  await page.getByLabel("Legal name").fill("Keys Test Ltd");
  await page.getByLabel("Country").selectOption("DE");
  await page.getByLabel("Registration number").fill("HRB 1");
  await page.getByLabel("Website").fill("keys.example");
  await page.getByLabel("Contact email").fill("ops@keys.example");
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(page.getByTestId("org-status")).toHaveText("In review");
  await page.goto("/app/admin");
  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("button", { name: "Confirm approve" }).click();
  await expect(page.getByText("No organization is waiting for review.")).toBeVisible();

  // The Phase 1 happy path (M3 as amended, step 1.10): /app opens the overview of the active org with
  // the welcome, the confidential account card, the recent activity (none yet) and the keys, Locked,
  // with the explainer; the wallet connects on it.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/app\/[0-9a-f-]{36}\/overview$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByTestId("account-sky")).toContainText("Your confidential account");
  await expect(page.getByTestId("activity-empty")).toHaveText(
    "No payments yet. The payments you make appear here, with amounts only you can read.",
  );
  await expect(page.getByTestId("keys-status")).toHaveText("Locked");
  await expect(page.getByTestId("keys-card")).toContainText("solana-conf-bal/v1");
  // One Unlock click, two signatures, one explainer (step 1.8.1).
  await expect(page.getByTestId("unlock-explainer")).toContainText(
    "Unlocking asks your wallet for two signatures, one after the other, so two wallet popups follow.",
  );
  await expect(page.getByTestId("unlock-warning")).toContainText(
    "can read the confidential balances of this wallet on every account, but can never move them. Only sign this in Sotto.",
  );
  await page.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByTestId("keys-wallet")).toContainText("EQMW…RLZC");
  // Nothing has been signed for keys yet: the signature is requested only by the click (10 section 3).
  expect(await signedMessages(page)).toEqual([]);

  // A wallet that refuses the key message gets the clear message and the recovery guide (10 section
  // 2, mitigation 3); the guide is public.
  await setRefused(page, ["solana-conf-bal/v1"]);
  await page.getByRole("button", { name: "Unlock with your wallet" }).click();
  await expect(page.getByTestId("keys-card").getByRole("alert")).toContainText(
    "Your wallet refused to sign the key message",
  );
  // The wallet's own words follow Sotto's explanation.
  await expect(page.getByTestId("keys-card").getByTestId("wallet-said")).toHaveText(
    'Sotto Test Wallet said: "This wallet does not sign this message"',
  );
  await expect(page.getByRole("link", { name: "Read the recovery guide" })).toHaveAttribute(
    "href",
    "/app/recovery",
  );
  await expect(page.getByTestId("keys-status")).toHaveText("Locked");
  const baseURL = test.info().project.use.baseURL;
  const visitor = await browser.newContext(baseURL ? { baseURL } : {});
  const guide = await visitor.newPage();
  await guide.goto("/app/recovery");
  await expect(
    guide.getByRole("heading", { name: "Reach your confidential balances without Sotto" }),
  ).toBeVisible();
  await expect(guide.getByText("spl-token withdraw-confidential-tokens")).toBeVisible();
  await visitor.close();
  await setRefused(page, []);

  const traffic: string[] = [];
  page.on("request", (request) => {
    traffic.push(`${request.method()} ${request.url()} ${JSON.stringify(request.headers())}`);
    traffic.push(request.postData() ?? "");
  });

  // A wallet that refuses the viewing key message: the confidential keys unlock, the viewing key does
  // not, and the card says what is not available (step 1.8.1).
  await setRefused(page, [`sotto-view-key/v1\n${wallet}`]);
  await page.getByRole("button", { name: "Unlock with your wallet" }).click();
  await expect(page.getByTestId("keys-status")).toHaveText("Unlocked");
  await expect(page.getByTestId("elgamal-public-key")).toHaveText(E2E_CLI_ELGAMAL_KEY);
  await expect(page.getByTestId("viewing-unlocked")).toHaveText("Not unlocked");
  await expect(page.getByTestId("viewing-missing")).toContainText(
    'Your wallet refused to sign the viewing key message. Sotto Test Wallet said: "This wallet does not sign this message"',
  );
  await expect(page.getByTestId("viewing-missing")).toContainText(
    "the amounts you keep sealed and the payment details shared with you stay closed in this tab",
  );
  expect(await signedMessages(page)).toEqual(["solana-conf-bal/v1"]);
  await setRefused(page, []);
  await page.getByRole("button", { name: "Sign the viewing key message" }).click();
  await expect(page.getByTestId("viewing-unlocked")).toHaveText("Unlocked");
  await expect(page.getByTestId("keys-status")).toHaveText("Unlocked");
  expect(await signedMessages(page)).toEqual([
    "solana-conf-bal/v1",
    `sotto-view-key/v1\n${wallet}`,
  ]);

  // The viewing key card is on Account setup; the tab's keys stay unlocked across the navigation.
  // The tab holds the viewing key, so registering takes one signature, which the server checks and
  // stores (07 section 5).
  await openSetup(page);
  await expect(page.getByTestId("viewing-unlocked")).toHaveText("Unlocked");
  await page.getByRole("button", { name: "Create viewing key" }).click();
  await expect(page.getByTestId("viewing-key-status")).toHaveText("Registered");
  const viewSignature = signWithTestKey(viewKeyMessage(wallet));
  const viewing = await deriveViewingKey(address(wallet), viewSignature);
  const viewingPublic = Buffer.from(viewing.publicKey).toString("base64");
  await expect(page.getByTestId("viewing-public-key")).toHaveText(viewingPublic);
  expect(await signedMessages(page)).toEqual([
    "solana-conf-bal/v1",
    `sotto-view-key/v1\n${wallet}`,
    `sotto-view-key-register/v1\n${viewingPublic}`,
  ]);
  const me = (await (await page.request.get("/api/me")).json()) as { user: { id: string } };
  const stored = (await (await page.request.get(`/api/users/${me.user.id}/viewer-key`)).json()) as {
    viewerKey: { wallet: string; publicKey: string; signature: string };
  };
  expect(stored.viewerKey.publicKey).toBe(viewingPublic);
  expect(
    await verifyViewKeyRegistration({
      wallet: stored.viewerKey.wallet,
      publicKey: new Uint8Array(Buffer.from(stored.viewerKey.publicKey, "base64")),
      signature: new Uint8Array(Buffer.from(stored.viewerKey.signature, "base64")),
    }),
  ).toBe(true);

  // No signature or key in any request (AC-03.2, I-2) or in browser storage (10 section 3).
  const keySignature = signWithTestKey(confidentialKeysMessage());
  const keys = await deriveStandardKeys(address(wallet), keySignature);
  expect(keys.elgamalPubkey).toBe(E2E_CLI_ELGAMAL_KEY);
  const secrets = [
    keySignature,
    keys.elgamalSecretKey,
    keys.aeKey,
    viewSignature,
    viewing.secretKey,
  ];
  const patterns = secrets.flatMap(encodings);
  const everything = traffic.join("\n");
  // The capture sees request bodies: the registration body with the public viewing key is in it.
  expect(everything).toContain("/api/viewer-keys");
  expect(everything).toContain(viewingPublic);
  for (const pattern of patterns) expect(everything).not.toContain(pattern);
  const storage = await page.evaluate(async () => ({
    local: JSON.stringify(Object.entries(localStorage)),
    session: JSON.stringify(Object.entries(sessionStorage)),
    cookie: document.cookie,
    databases: (await indexedDB.databases()).map((db) => db.name),
  }));
  // Sotto opens no IndexedDB database; next dev adds its own debug channel, never present in builds.
  expect(storage.databases.filter((name) => name !== "__next_debug_channel")).toEqual([]);
  for (const pattern of patterns) {
    expect(storage.local + storage.session + storage.cookie).not.toContain(pattern);
  }

  // Locking ends the keys and the crypto worker; a reload starts Locked again and shows no key.
  await page.getByRole("button", { name: "Lock" }).click();
  await expect(page.getByTestId("keys-status")).toHaveText("Locked");
  await expect.poll(() => page.workers().length).toBe(0);
  await page.getByRole("button", { name: "Unlock with your wallet" }).click();
  await expect(page.getByTestId("keys-status")).toHaveText("Unlocked");
  await expect(page.getByTestId("viewing-unlocked")).toHaveText("Unlocked");
  await page.reload();
  await expect(page.getByTestId("keys-status")).toHaveText("Locked");
  await expect(page.getByTestId("elgamal-public-key")).toHaveCount(0);
  await expect(page.getByTestId("viewing-key-status")).toHaveText("Registered");
  // The Locked state for AC-03.5: the keys card shows Locked and the explainer, never a value.
  await expect(page.getByTestId("keys-card")).toContainText("Unlock with your wallet");
});
