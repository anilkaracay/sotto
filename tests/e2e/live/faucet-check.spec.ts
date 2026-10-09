// The devUSD faucet tried once in a browser on the hosted devnet app (step 4.3's live plan; founder,
// 2026-10-03), with a fresh demo wallet: it creates a devUSD organization, the run's admin approves it,
// and on the setup page the faucet card gives 1,000,000 devUSD (the worker on the server mints it, read
// back on the page and from the faucet's own record), then says the 24 hour limit on a second request,
// which the server refuses too (429 faucet_limit).
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { connectWallet } from "../flows.ts";
import {
  ANY_APP_PAGE,
  approveOrg,
  OVERVIEW_URL,
  openSetup,
  sendOrganization,
  signIn,
} from "../helpers.ts";
import { shoot } from "../shots/shoot.ts";

const DIR = process.env.SOTTO_LIVE_DIR;
if (!DIR) throw new Error("SOTTO_LIVE_DIR is not set: run through scripts/live-demo.ts");
const keypair = async (name: string) =>
  JSON.parse(await readFile(join(DIR, `${name}.json`), "utf8")) as number[];

test.use({ actionTimeout: 60_000 });

test("the faucet gives 1,000,000 devUSD once and then says the 24 hour limit", async ({
  page,
  browser,
}) => {
  const { legalName } = JSON.parse(await readFile(join(DIR, "run.json"), "utf8")) as {
    legalName: string;
  };
  await signIn(page, await keypair("owner"));
  await page.getByLabel("Legal name").fill(legalName);
  await page.getByLabel("Country").selectOption("GB");
  await page.getByLabel("Registration number").fill("FC 0001");
  await page.getByLabel("Website").fill("faucet-check.example");
  await page.getByLabel("Contact email").fill("ops@faucet-check.example");
  await page.getByLabel("Currency").selectOption("devusd");
  await sendOrganization(page, async () => {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL ?? "" });
    const admin = await context.newPage();
    await signIn(admin, await keypair("admin"), ANY_APP_PAGE);
    await approveOrg(admin, legalName);
    await context.close();
  });
  await expect(async () => {
    await page.goto("/app/onboarding");
    await expect(page.getByTestId("attestation-address")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 300_000 });
  await page.goto("/app");
  await expect(page).toHaveURL(OVERVIEW_URL);
  const orgId = OVERVIEW_URL.exec(new URL(page.url()).pathname)?.[1] ?? "";
  await openSetup(page);
  await connectWallet(page);

  const card = page.getByTestId("faucet-card");
  await expect(card.getByTestId("faucet-remaining")).toContainText("1000000 devUSD");
  await shoot(page, "live-faucet-01-before", card);
  await card.getByLabel("Amount of devUSD").fill("1000000");
  await card.getByRole("button", { name: "Get devUSD" }).click();
  await expect(card.getByTestId("faucet-latest")).toContainText(
    "Minted 1000000 devUSD to your wallet",
    { timeout: 300_000 },
  );
  await expect(page.getByTestId("balance-public-usdc-value")).toHaveText("1000000 devUSD", {
    timeout: 120_000,
  });
  await shoot(page, "live-faucet-02-minted", card);

  // The second request: the card says the limit, and the server refuses it too.
  await page.reload();
  await expect(card.getByTestId("faucet-remaining")).toContainText("0 devUSD");
  await card.getByLabel("Amount of devUSD").fill("1");
  await expect(card.getByTestId("faucet-limit")).toContainText(
    "A wallet can get at most 1,000,000 devUSD in 24 hours",
  );
  await expect(card.getByRole("button", { name: "Get devUSD" })).toBeDisabled();
  await shoot(page, "live-faucet-03-limit", card);
  const origin = new URL(test.info().project.use.baseURL ?? "").origin;
  const refused = await page.request.post(`/api/orgs/${orgId}/faucet`, {
    data: { amount: "1" },
    headers: { origin },
  });
  expect(refused.status()).toBe(429);
  const refusal = (await refused.json()) as { error: { code: string; message: string } };
  expect(refusal.error.code).toBe("faucet_limit");
  const state = (await (await page.request.get(`/api/orgs/${orgId}/faucet`)).json()) as {
    faucet: { wallet: string; remaining: string; mints: { status: string; signature: string }[] };
  };
  expect(state.faucet.mints[0]?.status).toBe("minted");
  await writeFile(
    join(DIR, "result.json"),
    `${JSON.stringify(
      {
        organization: legalName,
        orgId,
        wallet: state.faucet.wallet,
        mintSignature: state.faucet.mints[0]?.signature,
        remainingAfter: state.faucet.remaining,
        secondRequest: `${refused.status()} ${refusal.error.code}: ${refusal.error.message}`,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
});
