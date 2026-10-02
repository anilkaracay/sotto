// The sign in screen in every state (step 3.4.1, 13 A34): with the test wallet only, with a wallet
// for each capability group of D-26 (the test wallet, a wallet that signs in but signs no messages,
// a wallet that cannot sign transactions), connected, a wallet that shares no account, and with no
// wallet at all; each at 1440 and 390 with no horizontal scroll and no console error, saved to this test's
// output directory and, once it passes, to .demo-shots/screens/<UTC time>-sign-in/ (git ignored),
// for the founder's approval. Runs in the node job: signing in needs no chain.
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { addTestWallet } from "../helpers.ts";

const DEMO_SHOTS = fileURLToPath(new URL("../../../.demo-shots/screens/", import.meta.url));
const shots: string[] = [];

/** Two wallets that only declare features, for the capability groups; neither can be used. */
const OTHER_WALLETS = `(() => {
  const icon = (color) => "data:image/svg+xml," + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='" + color + "'/></svg>");
  const make = (name, color, features) => ({
    version: "1.0.0",
    name,
    icon: icon(color),
    chains: ["solana:devnet"],
    accounts: [],
    features: Object.fromEntries(features.map((feature) => [feature, feature === "solana:signTransaction"
      ? { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: async () => { throw new Error("display only"); } }
      : { version: "1.0.0", connect: async () => ({ accounts: [] }), on: () => () => {}, signIn: async () => { throw new Error("display only"); } }])),
  });
  const wallets = [
    make("Ledger Lite", "#7c5cff", ["standard:connect", "standard:events", "solana:signIn", "solana:signTransaction"]),
    make("Watch Only", "#94a3b8", ["standard:connect", "standard:events"]),
  ];
  const register = ({ register: add }) => add(...wallets);
  window.addEventListener("wallet-standard:app-ready", ({ detail }) => register(detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
})();`;

async function shoot(page: Page, name: string) {
  const width = page.viewportSize()?.width ?? 1440;
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  const path = test.info().outputPath(`${name}-${width}.png`);
  await page.screenshot({ path, fullPage: true });
  shots.push(path);
}

for (const width of [1440, 390]) {
  test(`the sign in screen in every state at ${width} (13 A34)`, async ({ browser }) => {
    const baseURL = test.info().project.use.baseURL;
    const open = async (wallets: "test" | "all" | "none") => {
      const context = await browser.newContext({
        ...(baseURL ? { baseURL } : {}),
        viewport: { width, height: 900 },
      });
      const page = await context.newPage();
      const problems: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning")
          problems.push(message.text());
      });
      if (wallets !== "none") await addTestWallet(page);
      if (wallets === "all") await page.addInitScript({ content: OTHER_WALLETS });
      await page.goto("/app/sign-in");
      await expect(page.getByTestId("what-sotto-is")).toBeVisible();
      return { page, problems };
    };

    const only = await open("test");
    await expect(only.page.getByTestId("wallet-group")).toHaveCount(1);
    await expect(only.page.getByTestId("beta-note")).toContainText("A beta on Solana devnet");
    await shoot(only.page, "01-sign-in");
    const option = only.page.getByTestId("wallet-option").filter({ hasText: "Sotto Test Wallet" });
    await option.getByRole("button", { name: "Connect" }).click();
    await expect(option).toContainText("Connected");
    await shoot(only.page, "03-sign-in-connected");
    expect(only.problems).toEqual([]);
    await only.page.context().close();

    const all = await open("all");
    await expect(all.page.locator('[data-testid="wallet-group"]')).toHaveCount(3);
    await expect(all.page.locator('[data-group="sign_in_only"]')).toContainText("Ledger Lite");
    await expect(all.page.locator('[data-group="unsupported"]')).toContainText(
      "It does not support signing transactions or signing in.",
    );
    await shoot(all.page, "02-sign-in-capability-groups");
    // A wallet that shares no account: the error in its row.
    const lite = all.page.getByTestId("wallet-option").filter({ hasText: "Ledger Lite" });
    await lite.getByRole("button", { name: "Connect" }).click();
    await expect(lite.getByRole("alert")).toHaveText("The wallet shared no account.");
    await shoot(all.page, "04-sign-in-wallet-error");
    expect(all.problems).toEqual([]);
    await all.page.context().close();

    const none = await open("none");
    await expect(none.page.getByTestId("no-wallets")).toBeVisible();
    await shoot(none.page, "05-sign-in-no-wallet");
    expect(none.problems).toEqual([]);
    await none.page.context().close();

    const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
    const folder = `${DEMO_SHOTS}${stamp}Z-sign-in-${width}`;
    await mkdir(folder, { recursive: true });
    for (const path of shots.filter((entry) => entry.endsWith(`-${width}.png`))) {
      await copyFile(path, `${folder}/${path.split("/").pop()}`);
    }
  });
}
