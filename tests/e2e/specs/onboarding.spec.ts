// F-02 in the browser, on a devnet configuration (this server's): quick start (step 4.6, D-33). A
// wallet that signs in for the first time fills in no form: its company, "My company", is made and
// verified at once with no review (D-30), and it lands on the dashboard, where the first-run card
// "Set up and get test money" lists its three steps. The company's details are changed later on its
// own page. The review of every other configuration is in the localnet specs (screens-entry, setup
// and the flows after it), the admin's decisions in the API tests and the attestation in the
// worker's localnet test. No ledger runs beside this server, so the card's steps cannot run here:
// their logic is in apps/web/test/first-run.test.ts, the faucets in the API and worker tests.
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { OVERVIEW_URL, signIn } from "../helpers.ts";

const SHOTS = fileURLToPath(new URL("../../../.demo-shots/quick-start/", import.meta.url));
const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");

test("AC-02.1 quick start on devnet: a new wallet gets its company with no form, verified at once (AC-02.3), and the first-run card", async ({
  page,
}) => {
  const wallet = await signIn(page, undefined, OVERVIEW_URL);
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

  // The first-run card: one card, three steps in order. This server has no ledger, so the faucets
  // cannot be read and the card says why; nothing on it claims a step ran.
  const card = page.getByTestId("first-run-card");
  await expect(card.getByRole("heading", { name: "Set up and get test money" })).toBeVisible();
  await expect(card.getByTestId("first-run-status")).toHaveText("0 of 3 done");
  const steps = card.getByRole("listitem");
  await expect(steps).toHaveCount(3);
  await expect(steps.nth(0)).toContainText("Test SOL for fees");
  await expect(steps.nth(1)).toContainText("Confidential account");
  await expect(steps.nth(2)).toContainText("1,000,000 devUSD");
  await expect(card.getByTestId("first-run-problem")).toHaveText(
    "The network could not be reached. Try again.",
  );
  await expect(card.getByRole("link", { name: "Verify on Solana" })).toHaveCount(0);
  await expect(page.getByTestId("first-run-card")).toHaveCount(1);

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

  // Screenshots of the first-run card at 1440 and 390, for the founder.
  await page.goto(`/app/${orgId}/overview`);
  await expect(page.getByTestId("first-run-card")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const folder = `${SHOTS}${stamp}Z`;
  await mkdir(folder, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.waitForTimeout(600);
    const path = test.info().outputPath(`first-run-card-${width}.png`);
    await page.getByTestId("first-run-card").screenshot({ path });
    await copyFile(path, `${folder}/first-run-card-${width}.png`);
  }
});
