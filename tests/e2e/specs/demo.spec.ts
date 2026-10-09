// The demo company in the browser (step 4.6, D-32; the founder's constraints of 2026-10-09), on this
// server's devnet configuration. The spec seeds a demo company into the server's database (three
// people with real keypairs, payments, a grant, a snapshot, a proof record; every record sealed and
// under manifests the owner's wallet signed) and writes the demo file the server reads. Then, as a
// visitor without a wallet session:
// - "Explore Northwind as" is on the landing and on the sign in screen, with the four roles.
// - Each role reads exactly its own records, opened in the browser with that role's published key.
// - Every screen carries the banner "Demo company on devnet · read only" with the roles, Compare
//   views and "Create your own company".
// - Every amount or record with an onchain counterpart has a "Verify on Solana" link.
// - Compare views shows one payment as each role's own view holds it.
// - Nothing asks a wallet for anything, and the browser sends only reads of the demo's routes,
//   with the demo's header and no cookie, even while the same browser holds a signed in session.
// Screenshots at 1440 and 390 go to this test's output and to .demo-shots/demo/<UTC time>/.
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Request } from "@playwright/test";
import { createDb } from "@sotto/db";
import { seedDemoCompany, type DemoFixture } from "../../../apps/web/test/helpers/demo-company.ts";
import { expectAccessible } from "../a11y.ts";
import { signIn } from "../helpers.ts";

const LOCALNET = fileURLToPath(new URL("../../../.localnet/", import.meta.url));
const SHOTS = fileURLToPath(new URL("../../../.demo-shots/demo/", import.meta.url));
const BANNER = "Demo company on devnet · read only";
const ROLES = ["Owner (Elif)", "Accountant (Daniel)", "Employee (Maya)", "Outsider"];
const tx = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
const account = (address: string) =>
  `https://explorer.solana.com/address/${address}?cluster=devnet`;

let demo: DemoFixture;
const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const url = (await readFile(`${LOCALNET}e2e-database-url`, "utf8")).trim();
  const database = createDb(url, { max: 1 });
  try {
    demo = await seedDemoCompany(database.db, "e2e");
  } finally {
    await database.close();
  }
  await writeFile(`${LOCALNET}e2e-demo-company.json`, JSON.stringify(demo.file), { mode: 0o600 });
});

/** Every request the page sends to the API, as (method, path, demo header, cookie). */
function watchApi(page: Page) {
  const seen: { method: string; path: string; demo: boolean; cookie: boolean }[] = [];
  const pending: Promise<void>[] = [];
  page.on("request", (request: Request) => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return;
    pending.push(
      request.allHeaders().then((headers) => {
        seen.push({
          method: request.method(),
          path: url.pathname,
          demo: headers["x-sotto-demo"] === "1",
          cookie: "cookie" in headers,
        });
      }),
    );
  });
  return async () => {
    await Promise.all(pending);
    return seen;
  };
}

const walletCalls = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __sottoTestWallet?: { calls: string[] } }).__sottoTestWallet?.calls ??
      null,
  );

async function banner(page: Page) {
  const top = page.getByTestId("demo-banner");
  await expect(top).toContainText(BANNER);
  for (const role of ROLES) await expect(top.getByRole("link", { name: role })).toBeVisible();
  await expect(top.getByRole("link", { name: "Compare views" })).toBeVisible();
  await expect(top.getByRole("link", { name: "Create your own company" })).toHaveAttribute(
    "href",
    "/app",
  );
}

async function shoot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
  const folder = `${SHOTS}${stamp}Z`;
  await mkdir(folder, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.waitForTimeout(200);
    const path = test.info().outputPath(`${name}-${width}.png`);
    await page.screenshot({ path, fullPage: true });
    await copyFile(path, `${folder}/${name}-${width}.png`);
    // Nothing runs past the phone's width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

test("the landing and the sign in screen offer the demo company's four roles", async ({ page }) => {
  await page.goto("/");
  const landing = page.getByTestId("demo-entry");
  await expect(landing).toContainText("Explore Northwind as");
  for (const [index, role] of ROLES.entries()) {
    await expect(landing.getByRole("link", { name: role })).toHaveAttribute(
      "href",
      `/demo/${["owner", "accountant", "employee", "outsider"][index]}`,
    );
  }
  await page.goto("/app/sign-in");
  const entry = page.getByTestId("demo-entry");
  await expect(entry).toContainText("Explore Northwind as");
  await expect(entry).toContainText("The demo company on devnet, read only. No wallet needed.");
  await entry.getByRole("link", { name: "Accountant (Daniel)" }).click();
  await expect(page).toHaveURL(/\/demo\/accountant$/);
  await banner(page);
});

test("the role picker, each role's own records, Compare views, and nothing asked of a wallet", async ({
  page,
}) => {
  // The same browser holds a real signed in session and a wallet: the demo uses neither.
  await signIn(page);
  const api = watchApi(page);

  await page.goto("/demo");
  await banner(page);
  await expect(page.getByTestId("demo-picker-title")).toHaveText("Explore Northwind as");
  const picker = page.getByTestId("demo-picker");
  for (const role of ["owner", "accountant", "employee", "outsider", "compare"]) {
    await expect(picker.getByTestId(`demo-pick-${role}`)).toBeVisible();
  }
  await expect(picker).toContainText("One payment, four readers");
  await expectAccessible(page, "the demo's role picker");
  await shoot(page, "01-role-picker");

  // Owner (Elif): the balance from her latest signed snapshot, with its date, and every payment.
  await picker.getByTestId("demo-pick-owner").click();
  await expect(page).toHaveURL(/\/demo\/owner$/);
  await banner(page);
  await expect(page.getByTestId("demo-balance-amount")).toHaveText("1422500 devUSD");
  await expect(page.getByTestId("demo-balance-date")).toContainText("As recorded on");
  await expect(page.getByTestId("demo-balance-date")).toContainText(
    "from Elif's latest signed balance snapshot",
  );
  await expect(
    page.getByTestId("demo-balance").getByRole("link", { name: /Verify on Solana/ }),
  ).toHaveAttribute("href", account(demo.orgAccount));
  const payments = page.getByTestId("demo-payment");
  await expect(payments).toHaveCount(4);
  const atlas = payments.filter({ hasText: "Atlas Freight" });
  await expect(atlas).toContainText("48200 devUSD");
  await expect(atlas).toContainText("Also readable by Daniel Osei");
  await expect(atlas.getByRole("link", { name: /Verify on Solana/ })).toHaveAttribute(
    "href",
    tx(demo.paid.atlas.signature),
  );
  await expect(payments.filter({ hasText: "Maya Chen" })).toContainText("9400 devUSD");
  await expect(page.getByTestId("demo-grants")).toContainText("Daniel Osei");
  await expect(page.getByTestId("demo-grants")).toContainText("Accountant, external");
  const proofs = page.getByTestId("demo-proofs");
  await expect(proofs).toContainText("Balance is at least 250,000 devUSD");
  await expect(proofs.getByRole("link", { name: "Open the public proof" })).toHaveAttribute(
    "href",
    `/v/${demo.proofRecord}`,
  );
  await expect(proofs.getByRole("link", { name: /Verify on Solana/ })).toHaveAttribute(
    "href",
    account(demo.proofRecord),
  );
  // No control on the screen changes anything: there is no button at all.
  await expect(page.getByRole("button")).toHaveCount(0);
  await expectAccessible(page, "the demo as the owner");
  await shoot(page, "02-owner");

  // Accountant (Daniel): the ledger of the granted period, and a search that stays in the browser.
  await page.getByTestId("demo-banner").getByRole("link", { name: "Accountant (Daniel)" }).click();
  await expect(page).toHaveURL(/\/demo\/accountant$/);
  await banner(page);
  await expect(page.getByTestId("demo-scope")).toContainText("Shared by Northwind Labs");
  await expect(page.getByTestId("demo-ledger-row")).toHaveCount(4);
  await expect(page.getByTestId("demo-ledger-total")).toContainText("4 payments, 77500 devUSD");
  const before = (await api()).length;
  await page.getByTestId("demo-search").fill("atlas");
  await expect(page.getByTestId("demo-ledger-row")).toHaveCount(1);
  await expect(page.getByTestId("demo-ledger-row")).toContainText("Freight, invoice 2291");
  await expect(
    page.getByTestId("demo-ledger-row").getByRole("link", { name: /Verify on Solana/ }),
  ).toHaveAttribute("href", tx(demo.paid.atlas.signature));
  expect((await api()).length).toBe(before);
  await page.getByTestId("demo-search").fill("");
  await expect(page.getByRole("button")).toHaveCount(0);
  await expectAccessible(page, "the demo as the accountant");
  await shoot(page, "03-accountant");

  // Employee (Maya): her own payslip, and nothing of anyone else.
  await page.getByTestId("demo-banner").getByRole("link", { name: "Employee (Maya)" }).click();
  await expect(page).toHaveURL(/\/demo\/employee$/);
  await banner(page);
  const slip = page.getByTestId("demo-payslip");
  await expect(slip).toHaveCount(1);
  await expect(slip).toContainText("9400 devUSD");
  await expect(slip).toContainText("Gross 12400 devUSD");
  await expect(slip).toContainText("Tax 3000 devUSD");
  await expect(slip.getByRole("link", { name: /Verify on Solana/ })).toHaveAttribute(
    "href",
    tx(demo.paid.mayaLine.signature),
  );
  const mayaText = await page.locator("main").innerText();
  for (const absent of ["Atlas Freight", "Jonas Weber", "48200", "7150", "1422500"]) {
    expect(mayaText).not.toContain(absent);
  }
  await expectAccessible(page, "the demo as the employee");
  await shoot(page, "04-employee");

  // Outsider: what the chain shows, with no amount of any payment.
  await page.getByTestId("demo-banner").getByRole("link", { name: "Outsider" }).click();
  await expect(page).toHaveURL(/\/demo\/outsider$/);
  await banner(page);
  const chain = page.getByTestId("demo-chain");
  await expect(chain.getByText("Sealed", { exact: true })).toHaveCount(4);
  await expect(chain).toContainText("1500000 wdevUSD");
  await expect(
    chain
      .getByRole("listitem")
      .first()
      .getByRole("link", { name: /Verify on Solana/ }),
  ).toHaveAttribute("href", /^https:\/\/explorer\.solana\.com\/tx\/.+\?cluster=devnet$/);
  const outsiderText = await page.locator("main").innerText();
  for (const absent of ["48200", "12750", "9400", "7150", "1422500", "Atlas Freight"]) {
    expect(outsiderText).not.toContain(absent);
  }
  await expect(page.getByTestId("demo-proofs")).toContainText("Balance is at least 250,000 devUSD");
  await expectAccessible(page, "the demo as an outsider");
  await shoot(page, "05-outsider");

  // Compare views: one payment, each column from that role's own view.
  await page.getByTestId("demo-banner").getByRole("link", { name: "Compare views" }).click();
  await expect(page).toHaveURL(/\/demo\/compare$/);
  await banner(page);
  await expect(page.getByTestId("demo-compare-lead")).toContainText(
    "Northwind Labs paid Atlas Freight",
  );
  await expect(page.getByTestId("compare-owner")).toContainText("48200 devUSD");
  await expect(page.getByTestId("compare-owner")).toContainText("Freight, invoice 2291");
  await expect(page.getByTestId("compare-accountant")).toContainText("48200 devUSD");
  await expect(page.getByTestId("compare-accountant")).toContainText("Every amount,");
  await expect(page.getByTestId("compare-employee")).toContainText("No record");
  await expect(page.getByTestId("compare-employee")).toContainText("holds 1 record, her own pay");
  for (const column of ["compare-owner", "compare-accountant"]) {
    await expect(
      page.getByTestId(column).getByRole("link", { name: /Verify on Solana/ }),
    ).toHaveAttribute("href", tx(demo.paid.atlas.signature));
  }
  await expect(page.getByTestId("compare-employee")).not.toContainText("48200");
  const outsider = page.getByTestId("compare-outsider");
  await expect(outsider).toContainText("Sealed");
  await expect(outsider).not.toContainText("48200");
  await expect(outsider.getByRole("link", { name: /Verify on Solana/ })).toHaveAttribute(
    "href",
    tx(demo.paid.atlas.signature),
  );
  await expectAccessible(page, "the demo's Compare views");
  await shoot(page, "06-compare-views");

  // Nothing was asked of the wallet on any demo screen (the banner's links keep the page).
  expect(await walletCalls(page)).toEqual([]);
  // Every request was a read of the demo's own routes, marked as the demo's and without a cookie,
  // though this browser holds a signed in session.
  const requests = await api();
  expect(requests.length).toBeGreaterThan(6);
  for (const request of requests) {
    expect(request, JSON.stringify(request)).toMatchObject({ method: "GET", demo: true });
    expect(request.path.startsWith("/api/demo/"), request.path).toBe(true);
    expect(request.cookie, request.path).toBe(false);
  }

  // The way out leads to the normal app, where this browser's own session still stands.
  await page.getByTestId("demo-exit").click();
  await expect(page).toHaveURL(/\/app\/onboarding$/);
});

test("a visitor with no wallet in the browser reads the demo, and an unknown role is not found", async ({
  page,
}) => {
  await page.goto("/demo/owner");
  await expect(page.getByTestId("demo-balance-amount")).toHaveText("1422500 devUSD");
  expect(await walletCalls(page)).toBeNull();
  expect((await page.goto("/demo/admin"))?.status()).toBe(404);
});
