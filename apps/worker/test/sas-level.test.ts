// The level the sas-issue job writes into an attestation (08 section 5; step 4.6, D-30).
import { BUSINESS_LEVEL_AUTOMATIC, BUSINESS_LEVEL_REVIEW } from "@sotto/sdk/attestation";
import { describe, expect, it } from "vitest";
import { attestationLevel } from "../src/jobs/sas-issue.ts";
import { LEVEL_AUTOMATIC, LEVEL_MANUAL_REVIEW } from "../src/sas/business-schema.ts";

describe("the attestation's level", () => {
  it("AC-02.3 is manual review after an admin's decision and automatic without one", () => {
    expect(attestationLevel({ reviewedBy: "11111111111111111111111111111111" })).toBe(1);
    expect(attestationLevel({ reviewedBy: null })).toBe(0);
  });

  it("uses the values the public proof page reads", () => {
    expect([LEVEL_AUTOMATIC, LEVEL_MANUAL_REVIEW]).toEqual([
      BUSINESS_LEVEL_AUTOMATIC,
      BUSINESS_LEVEL_REVIEW,
    ]);
    expect(BUSINESS_LEVEL_REVIEW).toBeGreaterThan(BUSINESS_LEVEL_AUTOMATIC);
  });
});
