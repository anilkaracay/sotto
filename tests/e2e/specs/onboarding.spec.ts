// F-02 in the browser: a signed in user without an organization creates one and sees it in review.
// Admin review and the attestation are covered by the API tests and the worker's localnet test.
import { expect, test } from "@playwright/test";
import { signIn } from "../helpers.ts";

test("AC-02.1 create an organization and see it in review (AC-02.2)", async ({ page }) => {
  const wallet = await signIn(page);
  await expect(page.getByRole("heading", { name: "Your organization" })).toBeVisible();

  // The form checks the fields before sending anything.
  await page.getByRole("button", { name: "Send for review" }).click();
  await expect(page.getByText("Enter the legal name as registered")).toBeVisible();
  await expect(page.getByText("Choose a country").last()).toBeVisible();

  await page.getByLabel("Legal name").fill("Northwind Labs Ltd");
  await page.getByLabel("Country").selectOption("TR");
  await page.getByLabel("Registration number").fill("0001");
  await page.getByLabel("Website").fill("northwind.example");
  await page.getByLabel("Contact email").fill("ops@northwind.example");
  await page.getByRole("button", { name: "Send for review" }).click();

  await expect(page.getByTestId("org-status")).toHaveText("In review");
  await expect(page.getByRole("heading", { name: "Northwind Labs Ltd" })).toBeVisible();
  await expect(
    page.getByText("Money features open once Sotto verifies the organization"),
  ).toBeVisible();
  await expect(page.getByText("https://northwind.example")).toBeVisible();
  await expect(page.getByText("Türkiye")).toBeVisible();

  const me = (await (await page.request.get("/api/me")).json()) as {
    user: { wallet: string };
    memberships: { orgName: string; orgStatus: string; role: string }[];
  };
  expect(me.user.wallet).toBe(wallet);
  expect(me.memberships).toEqual([
    expect.objectContaining({
      orgName: "Northwind Labs Ltd",
      orgStatus: "pending_review",
      role: "owner",
    }),
  ]);

  // /app keeps sending the owner to the status page, which survives a reload.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/app\/onboarding$/);
  await expect(page.getByTestId("org-status")).toHaveText("In review");

  // Details can change while the org is in review.
  await page.getByRole("button", { name: "Change details" }).click();
  await page.getByLabel("Display name").fill("Northwind");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "Northwind", exact: true })).toBeVisible();
  await expect(page.getByTestId("org-status")).toHaveText("In review");

  // The admin console does not exist for a user who is not a Sotto admin.
  const admin = await page.goto("/app/admin");
  expect(admin?.status()).toBe(404);
});
