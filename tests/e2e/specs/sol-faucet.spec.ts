// The faucet's devnet SOL card in the browser (step 4.6, D-31), on this server's devnet
// configuration: quick start makes a new wallet's company at once (D-30, D-33), so its owner reaches
// Account setup and the card. No ledger runs beside this server, so the faucet's answers are stood in by the spec: the
// wallet may ask, asks once, the grant is on its way, then paid with its link to the explorer, and
// the wallet's next time. The limits themselves are in the API tests (apps/web/test/api-sol-faucet.test.ts)
// and the transfer in the worker's localnet test. Step 4.10 (D-37): a request refused for a limit shows
// where else devnet SOL comes from, on the checklist and on this card. Step 4.11 (D-38): the checklist's
// first step with the faucet's answers stood in: asked once, sent, paid with its link, and the next
// step in turn saying what the wallet will ask.
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Locator } from "@playwright/test";
import { expectAccessible } from "../a11y.ts";
import { openSetup, OVERVIEW_URL, signIn } from "../helpers.ts";

const SHOTS = fileURLToPath(new URL("../../../.demo-shots/ready/", import.meta.url));
const stamp = new Date().toISOString().slice(0, 19).replaceAll(":", "-");
/** A picture of the checklist as it stands, for the founder (git ignored). */
async function shoot(card: Locator, name: string) {
  await card.page().evaluate(() => document.fonts.ready);
  await card.page().waitForTimeout(600);
  const path = test.info().outputPath(`${name}.png`);
  await card.screenshot({ path });
  await mkdir(`${SHOTS}${stamp}Z`, { recursive: true });
  await copyFile(path, `${SHOTS}${stamp}Z/${name}.png`);
}

const SIGNATURE =
  "5B1L6sgtbhLdQ1Zr8mVh3XkYc2uJ7pNfW4aTqE9oGdRs6yHnKb3vCx8MzPjUeA2iFwQt7LgD4hSnV9rYkB1mXcZ";

test("the SOL faucet card: a new wallet asks once, sees the grant paid and its link to the chain", async ({
  page,
}) => {
  const wallet = await signIn(page, undefined, OVERVIEW_URL);

  const grant = {
    id: "a0000000-0000-4000-8000-000000000002",
    lamports: "50000000",
    createdAt: "2026-10-09T12:00:00.000Z",
  };
  let step: "new" | "sent" | "paid" = "new";
  let posts = 0;
  await page.route("**/api/faucet/sol", async (route) => {
    if (route.request().method() === "POST") {
      posts += 1;
      expect(route.request().postDataJSON()).toEqual({});
      step = "sent";
      await route.fulfill({
        status: 202,
        json: { grant: { ...grant, status: "pending", signature: null } },
      });
      return;
    }
    const grants =
      step === "new"
        ? []
        : [
            step === "sent"
              ? { ...grant, status: "sent", signature: SIGNATURE, refilling: false }
              : { ...grant, status: "paid", signature: SIGNATURE, refilling: false },
          ];
    await route.fulfill({
      json: {
        faucet: {
          wallet,
          grantLamports: "50000000",
          ceilingLamports: "20000000",
          balanceLamports: step === "paid" ? "50000000" : "0",
          state: step === "new" ? "available" : "used",
          nextAt: step === "new" ? null : "2026-10-10T12:00:00.000Z",
          grants,
        },
      },
    });
  });

  await openSetup(page);
  const card = page.getByTestId("sol-faucet-card");
  await expect(card).toContainText("Get devnet SOL");
  await expect(card).toContainText("On devnet it has no value.");
  await expect(card.getByTestId("sol-faucet-balance")).toHaveText("Your wallet holds 0 SOL now.");

  await card.getByRole("button", { name: "Get 0.05 SOL" }).click();
  await expect(card.getByTestId("sol-faucet-latest")).toHaveText(
    "Sotto is sending your SOL. This takes about half a minute.",
  );
  await expect(card.getByRole("button", { name: "Sending…" })).toBeDisabled();

  step = "paid";
  const latest = card.getByTestId("sol-faucet-latest");
  await expect(latest).toContainText("Sent 0.05 SOL to your wallet.", { timeout: 15_000 });
  await expect(latest.getByRole("link", { name: "Verify on Solana" })).toHaveAttribute(
    "href",
    `https://explorer.solana.com/tx/${SIGNATURE}?cluster=devnet`,
  );
  await expect(card.getByTestId("sol-faucet-balance")).toHaveText(
    "Your wallet holds 0.05 SOL now.",
  );
  await expect(card.getByTestId("sol-faucet-state")).toHaveText(
    "Your wallet got its SOL for these 24 hours. It can ask again after 10 Oct, 12:00 UTC.",
  );
  await expect(card.getByRole("button", { name: "Get 0.05 SOL" })).toBeDisabled();
  expect(posts).toBe(1);
  // Scanned once the page's entry motion has ended.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  await expectAccessible(page, "the setup page with the SOL faucet card");
});

test("a request the SOL faucet refuses for its limit points to Solana's own faucet, on the card and on Account setup", async ({
  page,
}) => {
  let wallet = "";
  let posts = 0;
  // The faucet as it answers a wallet from a network address that had its requests for the day. The
  // answers are in place before the wallet signs in, so the card reads them when it first shows.
  await page.route("**/api/faucet/sol", async (route) => {
    if (route.request().method() === "POST") {
      posts += 1;
      await route.fulfill({
        status: 429,
        headers: { "retry-after": "3600" },
        json: { error: { code: "rate_limited", message: "Too many requests, retry later" } },
      });
      return;
    }
    await route.fulfill({
      json: {
        faucet: {
          wallet,
          grantLamports: "50000000",
          ceilingLamports: "20000000",
          balanceLamports: "0",
          state: "available",
          nextAt: null,
          grants: [],
        },
      },
    });
  });
  await page.route("**/api/orgs/*/faucet", async (route) => {
    await route.fulfill({
      json: { faucet: { wallet, limit: "1000000000000", remaining: "1000000000000", mints: [] } },
    });
  });

  wallet = await signIn(page, undefined, OVERVIEW_URL);

  // The checklist's first step: the note with its link, in place of the bare refusal.
  const card = page.getByTestId("ready-checklist");
  await expect(card.getByTestId("ready-sol")).toContainText("Your wallet holds 0 SOL");
  await expect(card.getByTestId("ready-approvals")).toHaveText(
    "No wallet approval: Sotto sends it.",
  );
  await expect(card.getByTestId("ready-sol-elsewhere")).toHaveCount(0);
  await card.getByRole("button", { name: "Get test SOL" }).click();
  const note = card.getByTestId("ready-sol-elsewhere");
  await expect(note).toHaveText(
    "Sotto's faucet cannot send this wallet test SOL right now. Get devnet SOL for it at faucet.solana.com, then reload this page.",
  );
  const link = note.getByRole("link", { name: "faucet.solana.com" });
  await expect(link).toHaveAttribute("href", "https://faucet.solana.com");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(card).not.toContainText("Too many requests");
  await expect(card.getByTestId("ready-sol")).toHaveAttribute("data-state", "stuck");
  expect(posts).toBe(1);

  // The SOL faucet card on Account setup says the same when its own request is refused.
  await openSetup(page);
  const faucet = page.getByTestId("sol-faucet-card");
  await faucet.getByRole("button", { name: "Get 0.05 SOL" }).click();
  const elsewhere = faucet.getByTestId("sol-faucet-elsewhere");
  await expect(elsewhere).toContainText("Get devnet SOL for it at faucet.solana.com");
  await expect(elsewhere.getByRole("link", { name: "faucet.solana.com" })).toHaveAttribute(
    "href",
    "https://faucet.solana.com",
  );
  await expect(faucet).not.toContainText("Too many requests");
  expect(posts).toBe(2);
});

test("the checklist's first step: asked once, paid with its link, then the account step says what the wallet will ask", async ({
  page,
}) => {
  let wallet = "";
  let step: "new" | "sent" | "paid" = "new";
  let posts = 0;
  const grant = {
    id: "a0000000-0000-4000-8000-000000000003",
    lamports: "50000000",
    createdAt: "2026-10-10T12:00:00.000Z",
  };
  await page.route("**/api/faucet/sol", async (route) => {
    if (route.request().method() === "POST") {
      posts += 1;
      step = "sent";
      await route.fulfill({
        status: 202,
        json: { grant: { ...grant, status: "pending", signature: null } },
      });
      return;
    }
    await route.fulfill({
      json: {
        faucet: {
          wallet,
          grantLamports: "50000000",
          ceilingLamports: "20000000",
          balanceLamports: step === "paid" ? "50000000" : "0",
          state: step === "new" ? "available" : "used",
          nextAt: step === "new" ? null : "2026-10-11T12:00:00.000Z",
          grants:
            step === "new"
              ? []
              : [
                  {
                    ...grant,
                    status: step === "sent" ? "sent" : "paid",
                    signature: SIGNATURE,
                    refilling: false,
                  },
                ],
        },
      },
    });
  });
  await page.route("**/api/orgs/*/faucet", async (route) => {
    await route.fulfill({
      json: { faucet: { wallet, limit: "1000000000000", remaining: "1000000000000", mints: [] } },
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  wallet = await signIn(page, undefined, OVERVIEW_URL);

  const card = page.getByTestId("ready-checklist");
  const sol = card.getByTestId("ready-sol");
  await expect(sol).toHaveAttribute("data-state", "active");
  // Exactly one button on the list: the step in turn.
  await expect(card.getByTestId("ready-button")).toHaveCount(1);
  await shoot(card, "ready-start");
  await card.getByRole("button", { name: "Get test SOL" }).click();
  await expect(sol).toHaveAttribute("data-state", "running");
  await expect(sol).toContainText("Sotto is sending 0.05 SOL");
  await expect(card.getByTestId("ready-button")).toHaveCount(0);

  step = "paid";
  await expect(sol).toHaveAttribute("data-state", "done", { timeout: 15_000 });
  await expect(sol).toContainText("Sotto sent 0.05 SOL. Your wallet holds 0.05 SOL.");
  await expect(sol.getByRole("link", { name: "Verify on Solana" })).toHaveAttribute(
    "href",
    `https://explorer.solana.com/tx/${SIGNATURE}?cluster=devnet`,
  );
  expect(posts).toBe(1);
  await expect(card.getByTestId("ready-status")).toHaveText("1 of 6 done");

  // The account step is in turn now: its one button, the explainer of the key signature, and
  // what the wallet will ask, before anything is signed.
  const account = card.getByTestId("ready-account");
  await expect(account).toHaveAttribute("data-state", "active");
  await expect(card.getByTestId("ready-button")).toHaveText(
    "Unlock my keys and set up the account",
  );
  await expect(card.getByTestId("ready-approvals")).toContainText("Your wallet will ask 4 times");
  await expect(account).toContainText("solana-conf-bal/v1");
  await shoot(card, "ready-account");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __sottoTestWallet?: { calls: string[] } }).__sottoTestWallet
          ?.calls ?? [],
    ),
  ).not.toContain("solana:signMessage");
});
