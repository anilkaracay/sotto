// Onboarding's verification tracker (step 3.4): the three steps of verification as they stand
// for an organization in review, verified with and without its attestation, and not verified. Step
// 4.3: the currency choice where the network has more than one asset, and the organization's currency.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { assetView } from "../lib/server/network-view.ts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, replace: () => undefined, push: () => undefined }),
}));

const { OrgOnboarding, stagesOf } = await import("../app/app/onboarding/org-onboarding.tsx");
type OnboardingOrg = import("../app/app/onboarding/org-onboarding.tsx").OnboardingOrg;

const org: OnboardingOrg = {
  id: "3f1b6a2e-5c4d-4e8f-9a0b-1c2d3e4f5a6b",
  displayName: "Northwind",
  legalName: "Northwind Labs Ltd",
  country: "NL",
  registrationNo: "KVK 1",
  website: "https://northwind.example",
  contactEmail: "ops@northwind.example",
  status: "pending_review",
  asset: "usdc",
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

describe("onboarding's currency (step 4.3, D-29)", () => {
  const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("asks for the currency only where the network has more than one, USDC first", () => {
    const both = renderToStaticMarkup(
      <OrgOnboarding org={null} assets={[assetView("usdc"), assetView("devusd")]} />,
    );
    expect(both).toContain('name="asset"');
    expect(text(both)).toContain("USDC devUSD, Sotto Devnet Test Dollar");
    expect(text(both)).toContain("It cannot be changed later.");
    const one = renderToStaticMarkup(<OrgOnboarding org={null} assets={[assetView("usdc")]} />);
    expect(one).not.toContain('name="asset"');
  });

  it("shows the organization's currency, with the badge for devUSD", () => {
    const usdc = text(renderToStaticMarkup(<OrgOnboarding org={org} assets={[]} />));
    expect(usdc).toContain("Currency USDC");
    expect(usdc).not.toContain("Devnet test dollar");
    const devusd = text(
      renderToStaticMarkup(<OrgOnboarding org={{ ...org, asset: "devusd" }} assets={[]} />),
    );
    expect(devusd).toContain("Currency devUSD Devnet test dollar");
  });
});
