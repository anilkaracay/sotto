// The devUSD faucet card at 1440 and 390 (step 4.3; founder, 2026-10-03). The card shows only on
// devnet for a devUSD organization, and the faucet runs only there, so this review aid uses the e2e
// server in its devnet configuration with an organization written straight into its test database
// and the faucet's answers stood in by the spec: first with the whole day's allowance left, then after
// a minted request. The real faucet is tried in a browser on devnet once devUSD exists there.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createDb, memberships, orgs, users } from "@sotto/db";
import { eq } from "drizzle-orm";
import { expect, test } from "@playwright/test";
import { seededKeypair } from "../fixtures.ts";
import { signIn } from "../helpers.ts";
import { shoot } from "./shoot.ts";

const DATABASE_URL_FILE = fileURLToPath(
  new URL("../../../.localnet/e2e-database-url", import.meta.url),
);

test("the faucet card at 1440 and 390", async ({ page }) => {
  const owner = seededKeypair("sotto-shots-faucet-owner/v1");
  await signIn(page, owner.keypair);
  const database = createDb((await readFile(DATABASE_URL_FILE, "utf8")).trim(), { max: 1 });
  let orgId: string;
  try {
    const [user] = await database.db.select().from(users).where(eq(users.wallet, owner.address));
    if (!user) throw new Error("the signed in user is not in the database");
    const [org] = await database.db
      .insert(orgs)
      .values({
        displayName: "Northwind Labs",
        legalName: "Northwind Labs Demo Ltd",
        country: "GB",
        registrationNo: "NW 0001",
        website: "https://northwind.example",
        contactEmail: "finance@northwind.example",
        ownerUserId: user.id,
        status: "active",
        asset: "devusd",
      })
      .returning({ id: orgs.id });
    if (!org) throw new Error("org not inserted");
    orgId = org.id;
    await database.db.insert(memberships).values({ orgId, userId: user.id, role: "owner" });
  } finally {
    await database.close();
  }

  let minted = false;
  const mint = {
    id: "a0000000-0000-4000-8000-000000000001",
    amount: "10000000000",
    status: "minted",
    signature:
      "5B1L6sgtbhLdQ1Zr8mVh3XkYc2uJ7pNfW4aTqE9oGdRs6yHnKb3vCx8MzPjUeA2iFwQt7LgD4hSnV9rYkB1mXcZ",
    createdAt: new Date().toISOString(),
  };
  await page.route(`**/api/orgs/${orgId}/faucet`, async (route) => {
    if (route.request().method() === "POST") {
      minted = true;
      await route.fulfill({
        status: 202,
        json: { mint: { ...mint, status: "pending", signature: null } },
      });
      return;
    }
    await route.fulfill({
      json: {
        faucet: {
          wallet: owner.address,
          limit: "10000000000",
          remaining: minted ? "0" : "10000000000",
          mints: minted ? [mint] : [],
        },
      },
    });
  });

  await page.goto(`/app/${orgId}/setup`);
  const card = page.getByTestId("faucet-card");
  await expect(card.getByTestId("faucet-remaining")).toContainText("10000 devUSD");
  await expect(card.getByTestId("devnet-test-badge")).toBeVisible();
  await shoot(page, "ui-04-faucet-card", card);
  await card.getByLabel("Amount of devUSD").fill("10000");
  await card.getByRole("button", { name: "Get devUSD" }).click();
  await expect(card.getByTestId("faucet-latest")).toContainText(
    "Minted 10000 devUSD to your wallet",
  );
  await expect(card.getByTestId("faucet-remaining")).toContainText("0 devUSD");
  await shoot(page, "ui-05-faucet-card-minted", card);
});
