// F-02 in the browser, on a devnet configuration (this server's): a signed in user without an
// organization creates one and it is verified at once, with no review (step 4.6, D-30). The review
// of every other configuration is in the localnet specs (screens-entry, setup and the flows after
// it), the admin's decisions in the API tests and the attestation in the worker's localnet test.
import { expect, test } from "@playwright/test";
import { signIn } from "../helpers.ts";

test("AC-02.1 create an organization on devnet and see it verified at once, with no review (AC-02.3)", async ({
  page,
}) => {
  const wallet = await signIn(page);
  await expect(page.getByRole("heading", { name: "Your organization" })).toBeVisible();
  await expect(page.getByTestId("form-lead")).toContainText(
    "On devnet Sotto verifies a new organization at once, without reviewing these details",
  );
  await expect(page.getByTestId("how-verification-works")).toContainText(
    "Nobody reviews the details on devnet.",
  );
  await expect(page.getByRole("button", { name: "Send for review" })).toHaveCount(0);

  // The form checks the fields before sending anything.
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByText("Enter the legal name as registered")).toBeVisible();
  await expect(page.getByText("Choose a country").last()).toBeVisible();

  await page.getByLabel("Legal name").fill("Northwind Labs Ltd");
  await page.getByLabel("Country").selectOption("TR");
  await page.getByLabel("Registration number").fill("0001");
  await page.getByLabel("Website").fill("northwind.example");
  await page.getByLabel("Contact email").fill("ops@northwind.example");
  await page.getByRole("button", { name: "Create organization" }).click();

  await expect(page.getByTestId("org-status")).toHaveText("Verified");
  await expect(page.getByRole("heading", { name: "Northwind Labs Ltd" })).toBeVisible();
  const tracker = page.getByTestId("verification-tracker");
  await expect(tracker).toContainText("Verified automatically");
  await expect(tracker).toContainText("On devnet, without a review");
  // No worker runs beside this server, so the attestation stays in its first state.
  await expect(tracker).toContainText("Being issued");
  await expect(
    page.getByText("Verified automatically on devnet, without a review. Money features are open."),
  ).toBeVisible();
  await expect(page.getByText(/Reviewed by Sotto|Sent for review|A Sotto admin/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change details" })).toHaveCount(0);
  await expect(page.getByText("https://northwind.example")).toBeVisible();
  await expect(page.getByText("Türkiye")).toBeVisible();

  const me = (await (await page.request.get("/api/me")).json()) as {
    user: { wallet: string };
    memberships: { orgId: string; orgName: string; orgStatus: string; role: string }[];
  };
  expect(me.user.wallet).toBe(wallet);
  expect(me.memberships).toEqual([
    expect.objectContaining({ orgName: "Northwind Labs Ltd", orgStatus: "active", role: "owner" }),
  ]);

  // Money features are on: the status page leads to the account setup, and /app to the overview.
  await page.getByRole("link", { name: "Set up the confidential account" }).click();
  await expect(page).toHaveURL(new RegExp(`/app/${me.memberships[0]?.orgId}/setup$`));
  await page.goto("/app");
  await expect(page).toHaveURL(new RegExp(`/app/${me.memberships[0]?.orgId}/overview$`));

  // The admin console does not exist for a user who is not a Sotto admin.
  const admin = await page.goto("/app/admin");
  expect(admin?.status()).toBe(404);
});
