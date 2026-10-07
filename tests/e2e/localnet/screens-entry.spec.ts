// The entry screens in every state (step 3.4 with /trust of step 3.3): the trust page
// at 1440, 390 and 360 (no horizontal scroll at the phone widths), and onboarding empty, refused,
// in review, verified with its attestation onchain, and not verified, each from the admin console's
// decision. Each state is checked for its words and saved as a full page screenshot to this test's
// output directory and, once the run passes, to .demo-shots/screens/<UTC time>-entry/ (git ignored),
// for the founder's approval. Sign in and /v/ wait for the founder's design files and are not shown.
// Runs in the localnet job of scripts/ci-local.sh (the worker issues the attestation), never devnet.
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { e2eKeypair, seededKeypair } from "../fixtures.ts";
import { ANY_APP_PAGE, clientAddress, signIn } from "../helpers.ts";
import { expectAccessible, expectQuietConsole, watchConsole } from "../a11y.ts";
import { expectVisual } from "../visual.ts";

const VERIFIED = seededKeypair(`sotto-e2e-entry-verified/${Date.now()}`);
const REFUSED = seededKeypair(`sotto-e2e-entry-refused/${Date.now()}`);
const DEMO_SHOTS = fileURLToPath(new URL("../../../.demo-shots/screens/", import.meta.url));

const shots: string[] = [];

/** A full page screenshot once fonts are in and the entrance animations have ended. */
async function shoot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  shots.push(path);
  // Step 3.8: the approved screen against its baseline.
  await expectVisual(page, name);
  // Step 3.10: no WCAG 2.1 A or AA violation in this state, and a quiet console up to it.
  await expectAccessible(page, name);
  expectQuietConsole(page, name);
}

async function newPage(browser: Browser, width = 1440, height = 900): Promise<Page> {
  const baseURL = test.info().project.use.baseURL;
  const context = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    extraHTTPHeaders: clientAddress(),
    viewport: { width, height },
  });
  const page = await context.newPage();
  watchConsole(page);
  return page;
}

async function sendForReview(page: Page, legalName: string) {
  await page.getByLabel("Legal name").fill(legalName);
  await page.getByLabel("Country").selectOption("NL");
  await page.getByLabel("Registration number").fill("KVK 37");
  await page.getByLabel("Website").fill("entry.example");
  await page.getByLabel("Contact email").fill("ops@entry.example");
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(page.getByTestId("org-status")).toHaveText("In review");
}

async function decide(admin: Page, legalName: string, action: "Approve" | "Reject") {
  await admin.goto("/app/admin");
  const row = admin.getByTestId("admin-org-row").filter({ hasText: legalName });
  await row.getByRole("button", { name: action }).click();
  await row.getByRole("button", { name: `Confirm ${action.toLowerCase()}` }).click();
  await expect(admin.getByTestId("admin-org-row").filter({ hasText: legalName })).toHaveCount(0);
}

test.use({ extraHTTPHeaders: { "x-forwarded-for": "198.51.100.16" } });

test("the entry screens in every state, for the design pass (L36)", async ({ browser }) => {
  test.setTimeout(600_000);

  // L36: the trust page, public, at the desktop and the phone widths.
  for (const [width, name] of [
    [1440, "01-trust-1440"],
    [390, "02-trust-390"],
    [360, "03-trust-360"],
  ] as const) {
    const visitor = await newPage(browser, width);
    const problems: string[] = [];
    visitor.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") problems.push(message.text());
    });
    await visitor.goto("/trust");
    await expect(visitor.getByRole("heading", { level: 1 })).toHaveText(
      "What Sotto can do with your money, and what it cannot.",
    );
    await expect(visitor.getByTestId("trust-card")).toHaveCount(7);
    expect(await visitor.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await shoot(visitor, name);
    expect(problems).toEqual([]);
    await visitor.context().close();
  }

  // A35: onboarding empty, refused by its own checks, in review.
  const owner = await newPage(browser);
  await signIn(owner, VERIFIED.keypair);
  await expect(owner.getByTestId("how-verification-works")).toBeVisible();
  await shoot(owner, "04-onboarding-empty");
  await owner.getByRole("button", { name: "Send for review" }).click();
  await expect(owner.getByText("Enter the legal name as registered")).toBeVisible();
  await shoot(owner, "05-onboarding-refused");
  await sendForReview(owner, "Northwind Entry Ltd");
  await expect(owner.getByTestId("verification-tracker")).toContainText("In review");
  await shoot(owner, "06-onboarding-in-review");

  const refused = await newPage(browser);
  await signIn(refused, REFUSED.keypair);
  await sendForReview(refused, "Refused Entry Ltd");

  const admin = await newPage(browser);
  await signIn(admin, e2eKeypair(), ANY_APP_PAGE);
  await decide(admin, "Northwind Entry Ltd", "Approve");
  await decide(admin, "Refused Entry Ltd", "Reject");
  await admin.context().close();

  // A35: verified, once the worker issued the attestation onchain.
  await expect(async () => {
    await owner.goto("/app/onboarding");
    await expect(owner.getByTestId("attestation-address")).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 120_000 });
  await expect(owner.getByTestId("org-status")).toHaveText("Verified");
  await expect(owner.getByTestId("verification-tracker")).toContainText("Issued to your wallet");
  await shoot(owner, "07-onboarding-verified");
  await owner.context().close();

  // A35: not verified.
  await refused.goto("/app/onboarding");
  await expect(refused.getByTestId("org-status")).toHaveText("Not verified");
  await expect(refused.getByTestId("verification-tracker")).toContainText("Not verified");
  await shoot(refused, "08-onboarding-not-verified");
  await refused.context().close();

  // The run passed: the screenshots also go where Playwright never clears them.
  const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
  const folder = `${DEMO_SHOTS}${stamp}Z-entry`;
  await mkdir(folder, { recursive: true });
  for (const path of shots) await copyFile(path, `${folder}/${path.split("/").pop()}`);
  console.log(`screens: ${folder}`);
});
