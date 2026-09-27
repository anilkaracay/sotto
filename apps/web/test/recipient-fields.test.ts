// Recipient fields and readiness wording (F-07; step 1.8), shared by the API and the recipients page:
// who can be paid confidentially and why not (AC-07.4), the field rules, and the private blob's shape.
import { describe, expect, it } from "vitest";
import {
  parseRecipientPrivate,
  payability,
  READINESS_LABEL,
  recipientFieldsSchema,
  recipientUpdateSchema,
} from "../lib/recipient.ts";

const WALLET = "EQMW3o1DVsB72Ej1RRRmHLW1XaEpbjLKrMHUbS8cRLZC";

describe("recipient readiness wording", () => {
  it("AC-07.4 says that recipients who are not ready cannot be paid confidentially, and why", () => {
    expect(payability("ready")).toEqual({
      payable: true,
      reason: "Ready: the wUSDC account at this wallet can receive confidential payments.",
    });
    expect(payability("no_account")).toMatchObject({ payable: false });
    expect(payability("no_account").reason).toContain("there is no wUSDC account at this wallet");
    expect(payability("not_configured")).toMatchObject({ payable: false });
    expect(payability("not_configured").reason).toContain("not set up for confidential payments");
    for (const readiness of ["no_account", "not_configured"] as const) {
      expect(payability(readiness).reason).toMatch(/^Cannot be paid confidentially yet: /);
      expect(payability(readiness).reason).toContain("invite link");
    }
    expect(READINESS_LABEL).toEqual({
      no_account: "No account",
      not_configured: "Not set up",
      ready: "Ready",
    });
  });
});

describe("recipient fields", () => {
  it("trims text, turns empty optional text into null and refuses what the API refuses", () => {
    expect(
      recipientFieldsSchema.parse({
        displayName: "  Maya Chen ",
        roleTitle: " ",
        team: "Design",
        country: "GB",
        wallet: ` ${WALLET} `,
      }),
    ).toEqual({
      displayName: "Maya Chen",
      roleTitle: null,
      team: "Design",
      country: "GB",
      wallet: WALLET,
    });
    for (const bad of [
      { displayName: "Maya", wallet: "not-a-wallet" },
      { displayName: "", wallet: WALLET },
      { displayName: "Maya", wallet: WALLET, country: "Great Britain" },
      { displayName: "Maya", wallet: WALLET, privateBlob: "not base64!" },
      { displayName: "Maya", wallet: WALLET, defaultAmount: "100" },
    ]) {
      expect(recipientFieldsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    expect(recipientUpdateSchema.safeParse({}).success).toBe(false);
    expect(recipientUpdateSchema.safeParse({ wallet: WALLET }).success).toBe(false);
  });

  it("reads only a well formed private blob", () => {
    expect(parseRecipientPrivate({ v: 1, default_amount: "9400000000", notes: "Monthly" })).toEqual(
      {
        v: 1,
        default_amount: "9400000000",
        notes: "Monthly",
      },
    );
    expect(parseRecipientPrivate({ v: 1, default_amount: null, notes: null })).not.toBeNull();
    for (const bad of [
      null,
      { v: 2, default_amount: null, notes: null },
      { v: 1, default_amount: "1.5", notes: null },
      { v: 1, default_amount: null },
      { v: 1, default_amount: null, notes: null, extra: 1 },
    ]) {
      expect(parseRecipientPrivate(bad)).toBeNull();
    }
  });
});
