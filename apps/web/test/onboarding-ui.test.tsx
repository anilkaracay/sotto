// Onboarding's verification tracker (13 A35; step 3.4): the three steps of verification as they stand
// for an organization in review, verified with and without its attestation, and not verified.
import { describe, expect, it } from "vitest";
import { stagesOf, type OnboardingOrg } from "../app/app/onboarding/org-onboarding.tsx";

const org: OnboardingOrg = {
  id: "3f1b6a2e-5c4d-4e8f-9a0b-1c2d3e4f5a6b",
  displayName: "Northwind",
  legalName: "Northwind Labs Ltd",
  country: "NL",
  registrationNo: "KVK 1",
  website: "https://northwind.example",
  contactEmail: "ops@northwind.example",
  status: "pending_review",
  attestationAddress: null,
  reviewedAt: null,
  createdAt: "2026-09-30T10:00:00.000Z",
};
const view = (value: OnboardingOrg) =>
  stagesOf(value).map((stage) => `${stage.state}: ${stage.title}, ${stage.detail}`);

describe("onboarding's verification tracker", () => {
  it("AC-02.2 shows the review as the current step while the organization is in review", () => {
    expect(view(org)).toEqual([
      "done: Sent for review, 30 Sep 2026",
      "current: Reviewed by Sotto, In review",
      "next: Attestation onchain, After the review",
    ]);
  });

  it("AC-02.3 shows the attestation being issued, then issued, once verified", () => {
    const verified = { ...org, status: "active" as const, reviewedAt: "2026-10-01T08:00:00.000Z" };
    expect(view(verified).slice(1)).toEqual([
      "done: Reviewed by Sotto, Verified, 1 Oct 2026",
      "current: Attestation onchain, Being issued",
    ]);
    expect(view({ ...verified, attestationAddress: "7K3A" }).at(-1)).toBe(
      "done: Attestation onchain, Issued to your wallet",
    );
  });

  it("AC-02.4 stops at the review when the organization is not verified", () => {
    const stopped = {
      ...org,
      status: "suspended" as const,
      reviewedAt: "2026-10-01T08:00:00.000Z",
    };
    expect(view(stopped).slice(1)).toEqual([
      "stopped: Reviewed by Sotto, Not verified, 1 Oct 2026",
      "next: Attestation onchain, None",
    ]);
  });
});
