// F-02 in the browser, on a devnet configuration (this server's): quick start (step 4.6, D-33). A
// wallet that signs in for the first time fills in no form: its company, "My company", is made and
// verified at once with no review (D-30), and it lands on the dashboard, where the checklist
// "Get ready to pay" lists its six steps (step 4.11, D-38). The company's details are changed later on its
// own page. The review of every other configuration is in the localnet specs (screens-entry, setup
// and the flows after it), the admin's decisions in the API tests and the attestation in the
// worker's localnet test. No ledger runs beside this server, so the card's steps cannot run here:
// their logic is in apps/web/test/ready.test.ts, the faucets in the API and worker tests.
// Step 4.8 (D-34): the company starts with the demo recipient, and a company without recipients has
// a recipient field that says so.
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { seededKeypair } from "../fixtures.ts";
import { OVERVIEW_URL, signIn } from "../helpers.ts";

const OWNER = seededKeypair("sotto-e2e-quick-start-owner/v1");

const SHOTS = fileURLToPath(new URL("../../../.demo-shots/quick-start/", import.meta.url));
const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");

test("AC-02.1 quick start on devnet: a new wallet gets its company with no form, verified at once (AC-02.3), and the checklist Get ready to pay", async ({
  page,
}) => {
  // A fixed key, so the wallet is the same one after a full page load (a random one is not).
  const wallet = await signIn(page, OWNER.keypair, OVERVIEW_URL);
  const orgId = OVERVIEW_URL.exec(page.url())?.[1] ?? "";

  // The dashboard of "My company", with no form on the way.
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByText("My company").first()).toBeVisible();
  const me = (await (await page.request.get("/api/me")).json()) as {
    user: { wallet: string };
    memberships: { orgId: string; orgName: string; orgStatus: string; role: string }[];
  };
  expect(me.user.wallet).toBe(wallet);
  expect(me.memberships).toEqual([
    { orgId, orgName: "My company", orgStatus: "active", role: "owner" },
  ]);

  // "Get ready to pay" (step 4.11, D-38): one checklist, six steps in order, the first in turn.
  // This server has no ledger, so the faucets cannot be read and the card says why; nothing on it
  // claims a step ran.
  const card = page.getByTestId("ready-checklist");
  await expect(card).toHaveAttribute("data-variant", "dashboard");
  await expect(card.getByRole("heading", { name: "Get ready to pay" })).toBeVisible();
  await expect(card.getByTestId("ready-status")).toHaveText("0 of 6 done");
  const steps = card.locator("ol > li");
  await expect(steps).toHaveCount(6);
  for (const [index, title] of [
    "Test SOL for fees",
    "Confidential account",
    "Public viewing key",
    "1,000,000 devUSD",
    "Move devUSD into the confidential balance",
    "Apply the pending balance",
  ].entries()) {
    await expect(steps.nth(index)).toContainText(title);
  }
  // Each step says why it is needed, and only the first is in turn.
  await expect(steps.nth(0)).toContainText(
    "Every Solana transaction pays a small network fee in SOL.",
  );
  await expect(steps.nth(2)).toContainText("Each payment's details are sealed to this key");
  await expect(card.locator('[data-state="waiting"]')).toHaveCount(5);
  await expect(card.getByTestId("ready-problem")).toHaveText(
    "The network could not be reached. Try again.",
  );
  await expect(card.getByRole("link", { name: "Verify on Solana" })).toHaveCount(0);
  await expect(page.getByTestId("ready-checklist")).toHaveCount(1);

  // Step 4.8 (D-35): the card links to the walkthrough, which pictures each step.
  await expect(card.getByTestId("ready-walkthrough")).toHaveAttribute("href", "/app/walkthrough");

  // Step 4.8 (D-34): the company starts with the demo recipient, named as one. This server has no
  // ledger, so its readiness is not read yet and the pay card lists it as not payable for now.
  await page.goto(`/app/${orgId}/recipients`);
  const demo = page.getByTestId("recipient-row");
  await expect(demo).toHaveCount(1);
  await expect(demo).toContainText("Atlas Freight (demo recipient)");
  await expect(demo).toContainText("Demo wallet for test payments");
  await expect(demo).toHaveAttribute("data-wallet", "E6FbeoKRFNcCuSGkbn6QJgGzwoNYfDeHELJLS5BLLkDB");
  await page.goto(`/app/${orgId}/payments/new`);
  const pay = page.getByTestId("pay-card");
  await expect(pay.getByLabel("Recipient").locator("option")).toHaveText([
    "Choose a recipient",
    /^Atlas Freight \(demo recipient\) · E6Fb…LkDB/,
  ]);
  await expect(pay.getByTestId("no-recipients")).toHaveCount(0);
  // Step 4.11 (D-38): the checklist is pinned on Payments until it is complete. With no ledger the
  // account cannot be read, so the form does not claim the list is unfinished; it names what it
  // knows is missing, the public viewing key, and registers it in place with the form kept.
  await expect(page.getByTestId("ready-checklist")).toHaveAttribute("data-variant", "pinned");
  await expect(pay.getByTestId("ready-first")).toHaveCount(0);
  // After a full page load this tab holds no wallet connection (the test wallet does not connect
  // by itself, as Phantom and Solflare do): the form says so and connects it in place, and the
  // pinned checklist offers the same. Connecting comes before the form is filled.
  const connect = pay.getByTestId("guidance-connect");
  await expect(connect).toContainText("Your wallet is not connected in this tab.");
  await expect(page.getByTestId("ready-connect")).toContainText(
    "Connect the wallet you signed in with",
  );
  await connect.getByRole("button", { name: "Connect" }).click();
  await expect(connect).toHaveCount(0);
  await expect(page.getByTestId("ready-connect")).toHaveCount(0);
  await pay.getByLabel("Recipient").selectOption({ index: 1 });
  await pay.getByLabel("Amount (devUSD)").fill("48200");
  await pay.getByLabel("Memo").fill("Freight, October");
  const missing = pay.getByTestId("guidance-viewing-key");
  await expect(missing).toContainText("Your public viewing key is not registered yet.");
  await expect(missing).toContainText(
    "A payment's details are sealed to it, so you can read your own record and nobody else can.",
  );
  await expect(pay).not.toContainText("Create your viewing key");
  await expect(pay).not.toContainText("Account setup page");
  await expect(pay.getByRole("button", { name: "Pay", exact: true })).toBeDisabled();
  await missing.getByRole("button", { name: "Register public viewing key" }).click();
  await expect(missing).toHaveCount(0);
  // The next thing in the way is named in its turn: the keys are locked in this tab.
  await expect(pay.getByTestId("guidance-locked")).toContainText(
    "Your keys are locked in this tab.",
  );
  await expect(page.getByTestId("viewing-key-status")).toHaveCount(0);
  await expect(pay.getByLabel("Amount (devUSD)")).toHaveValue("48200");
  await expect(pay.getByLabel("Memo")).toHaveValue("Freight, October");
  // A recipient who cannot receive yet is said plainly. Here it is the demo recipient itself, its
  // account unread without a ledger, so no other recipient is offered in its place.
  const cannot = pay.getByTestId("guidance-recipient");
  await expect(cannot).toContainText(
    "Atlas Freight (demo recipient) cannot receive a confidential payment yet.",
  );
  await expect(cannot.getByRole("button")).toHaveCount(0);

  // It is removed like any recipient, and then the recipient field says so and leads back.
  await page.goto(`/app/${orgId}/recipients`);
  await demo.getByRole("button", { name: "Remove" }).click();
  await demo.getByRole("button", { name: "Confirm remove" }).click();
  await expect(page.getByTestId("recipients-empty")).toBeVisible();
  await page.goto(`/app/${orgId}/payments/new`);
  await expect(pay.getByLabel("Recipient")).toBeDisabled();
  await expect(pay.getByLabel("Recipient").locator("option")).toHaveText(["No recipients yet"]);
  await expect(pay.getByTestId("no-recipients")).toHaveText("No recipients yet. Add a recipient");
  await pay.getByRole("link", { name: "Add a recipient" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${orgId}/recipients$`));

  // The company's own page: verified automatically, details not set, and changed there later.
  await page.goto("/app/onboarding");
  await expect(page.getByTestId("org-status")).toHaveText("Verified");
  await expect(page.getByRole("heading", { name: "My company" })).toBeVisible();
  const tracker = page.getByTestId("verification-tracker");
  await expect(tracker).toContainText("Verified automatically");
  await expect(tracker).toContainText("On devnet, without a review");
  // No worker runs beside this server, so the attestation stays in its first state.
  await expect(tracker).toContainText("Being issued");
  await expect(page.getByText(/Reviewed by Sotto|Sent for review|A Sotto admin/)).toHaveCount(0);
  await expect(page.getByText("Not set")).toHaveCount(4);
  await expect(page.getByTestId("org-asset")).toContainText("devUSD");

  await page.getByTestId("edit-details").click();
  await expect(page.getByTestId("form-lead")).toContainText(
    "Only the name is needed. When the legal name or the country changes, Sotto issues the attestation onchain again with the new details",
  );
  await page.getByLabel("Legal name").fill("Acme Trading Ltd");
  await page.getByLabel("Country").selectOption("TR");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "Acme Trading Ltd" })).toBeVisible();
  await expect(page.getByText("Türkiye")).toBeVisible();
  await expect(page.getByText("Not set")).toHaveCount(3);
  await expect(page.getByTestId("org-status")).toHaveText("Verified");
  const after = (await (await page.request.get(`/api/orgs/${orgId}`)).json()) as {
    org: Record<string, unknown>;
  };
  expect(after.org).toMatchObject({
    legalName: "Acme Trading Ltd",
    country: "TR",
    registrationNo: null,
    status: "active",
    verification: "automatic",
    attestationAddress: null,
  });

  // /app keeps opening the dashboard, and a second quick start changes nothing.
  await page.goto("/app");
  await expect(page).toHaveURL(new RegExp(`/app/${orgId}/overview$`));
  const again = await page.request.post("/api/orgs/quick-start", {
    data: {},
    headers: { origin: new URL(page.url()).origin },
  });
  expect(again.status()).toBe(200);
  expect(((await again.json()) as { org: { id: string } }).org.id).toBe(orgId);

  // The admin console does not exist for a user who is not a Sotto admin.
  const admin = await page.goto("/app/admin");
  expect(admin?.status()).toBe(404);

  // The same checklist is pinned on Payroll (and on Proofs, whose page reads the proof program on
  // the server and so needs a ledger: the live rehearsal sees it there). Whether the wallet is
  // ready is read from its account onchain, which this server cannot reach, so the page does not
  // claim that the list is unfinished (the rule is in apps/web/test/ready.test.ts).
  await page.goto(`/app/${orgId}/payroll`);
  await expect(page.getByTestId("ready-checklist")).toHaveAttribute("data-variant", "pinned");
  // The public viewing key registered on the pay form above counts on the list.
  await expect(page.getByTestId("ready-status")).toHaveText("1 of 6 done");
  await expect(page.getByTestId("ready-viewingKey")).toHaveAttribute("data-state", "done");
  await expect(page.getByText("Finish Get ready to pay above first")).toHaveCount(0);

  // Screenshots of the checklist at 1440 and 390, for the founder.
  await page.goto(`/app/${orgId}/overview`);
  await expect(page.getByTestId("ready-checklist")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const folder = `${SHOTS}${stamp}Z`;
  await mkdir(folder, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.waitForTimeout(600);
    const path = test.info().outputPath(`ready-checklist-${width}.png`);
    await page.getByTestId("ready-checklist").screenshot({ path });
    await copyFile(path, `${folder}/ready-checklist-${width}.png`);
  }
});
