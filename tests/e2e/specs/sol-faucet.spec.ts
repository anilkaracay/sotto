// The faucet's devnet SOL card in the browser (step 4.6, D-31), on this server's devnet
// configuration: quick start makes a new wallet's company at once (D-30, D-33), so its owner reaches
// Account setup and the card. No ledger runs beside this server, so the faucet's answers are stood in by the spec: the
// wallet may ask, asks once, the grant is on its way, then paid with its link to the explorer, and
// the wallet's next time. The limits themselves are in the API tests (apps/web/test/api-sol-faucet.test.ts)
// and the transfer in the worker's localnet test.
import { expect, test } from "@playwright/test";
import { expectAccessible } from "../a11y.ts";
import { openSetup, OVERVIEW_URL, signIn } from "../helpers.ts";

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
