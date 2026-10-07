// The shared organization rules (lib/org.ts) and the country list (lib/countries.ts).
import { describe, expect, it } from "vitest";
import { COUNTRIES, countryName, isCountryCode } from "../lib/countries.ts";
import {
  LEGAL_NAME_MAX_BYTES,
  moneyEnabled,
  normalizeWebsite,
  orgStatusLabel,
} from "../lib/org.ts";

describe("organization rules", () => {
  it("AC-02.2 enables money features for active orgs only", () => {
    expect(moneyEnabled("pending_review")).toBe(false);
    expect(moneyEnabled("active")).toBe(true);
    expect(moneyEnabled("suspended")).toBe(false);
  });

  it("names the statuses as the app shows them", () => {
    expect(orgStatusLabel("pending_review")).toBe("In review");
    expect(orgStatusLabel("active")).toBe("Verified");
    expect(orgStatusLabel("suspended")).toBe("Not verified");
  });

  it("adds https:// to a bare domain in the form and leaves a URL with a scheme alone", () => {
    expect(normalizeWebsite(" northwind.example ")).toBe("https://northwind.example");
    expect(normalizeWebsite("http://northwind.example")).toBe("http://northwind.example");
    expect(normalizeWebsite("ftp://northwind.example")).toBe("ftp://northwind.example");
    expect(normalizeWebsite("  ")).toBe("");
  });

  it("caps the legal name at the size the localnet attestation test proves", () => {
    // apps/worker/test/sas-issue-localnet.test.ts issues an attestation with a 400 byte legal name.
    // Raise both together.
    expect(LEGAL_NAME_MAX_BYTES).toBe(400);
  });
});

describe("country list", () => {
  it("has the 249 ISO 3166-1 alpha-2 codes, once each, sorted by name", () => {
    expect(COUNTRIES).toHaveLength(249);
    expect(new Set(COUNTRIES.map(([code]) => code)).size).toBe(249);
    expect(COUNTRIES.every(([code]) => /^[A-Z]{2}$/.test(code))).toBe(true);
    const names = COUNTRIES.map(([, name]) => name);
    const collator = new Intl.Collator("en", { sensitivity: "base" });
    expect([...names].sort(collator.compare)).toEqual(names);
  });

  it("knows real codes and refuses reserved ones", () => {
    expect(countryName("TR")).toBe("Türkiye");
    expect(countryName("GB")).toBe("United Kingdom");
    expect(isCountryCode("DE")).toBe(true);
    for (const code of ["XX", "EU", "UK", "ZZ", "tr"]) expect(isCountryCode(code)).toBe(false);
  });
});
