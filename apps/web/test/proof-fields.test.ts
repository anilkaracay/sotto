// Proof of funds in words (F-13, step 2.8): the statement always says "at least" and never
// rounds the threshold; custom amounts parse as dollars; the chips are the design's; the expiry is
// counted from now; a record's state and validity read as the chain shows them; every program error
// has plain words; and the server's counterparty hash is the tab's. Step 4.3: a devUSD record
// names its symbol and never says USDC or "$".
import { counterpartyHash } from "@sotto/sdk/proofs";
import { describe, expect, it } from "vitest";
import {
  expiryFrom,
  expiryWords,
  NOT_PROVEN,
  NOT_PROVEN_DETAIL,
  parseThreshold,
  proofErrorWords,
  PROVEN,
  recordState,
  statementWords,
  thresholdChips,
  thresholdWords,
  VALIDITY_OPTIONS,
  verifyPath,
} from "../lib/proofs.ts";
import { counterpartyHashOf } from "../lib/server/proofs.ts";
import { assetWords } from "../lib/asset-words.ts";

const USDC = 1_000_000n;
const USDC_WORDS = assetWords("usdc");
const DEVUSD_WORDS = assetWords("devusd");

describe("proof of funds words (F-13)", () => {
  it("AC-13.1 states Balance is at least $X with every digit of the threshold", () => {
    expect(statementWords(100_000n * USDC, USDC_WORDS)).toBe("Balance is at least $100,000");
    expect(statementWords(2_500_000n * USDC, USDC_WORDS)).toBe("Balance is at least $2,500,000");
    expect(thresholdWords(7n * USDC, USDC_WORDS)).toBe("$7");
    expect(thresholdWords(1_500_000n, USDC_WORDS)).toBe("$1.50");
    expect(thresholdWords(1_234_567n, USDC_WORDS)).toBe("$1.234567");
    expect(thresholdWords(1n, USDC_WORDS)).toBe("$0.000001");
    const chips = thresholdChips(USDC_WORDS);
    expect(chips.map((chip) => [chip.label, thresholdWords(chip.base, USDC_WORDS)])).toEqual([
      ["$100k", "$100,000"],
      ["$500k", "$500,000"],
      ["$1M", "$1,000,000"],
      ["$2.5M", "$2,500,000"],
    ]);
    // D-06: the result words, never True or False.
    expect([PROVEN, NOT_PROVEN]).toEqual(["Proven", "Not proven"]);
    expect(NOT_PROVEN_DETAIL).toBe(
      "This statement could not be proven. Nothing else was revealed.",
    );
  });

  it("step 4.3: a devUSD statement names devUSD, never USDC or a dollar sign", () => {
    expect(statementWords(250_000n * USDC, DEVUSD_WORDS)).toBe(
      "Balance is at least 250,000 devUSD",
    );
    expect(thresholdWords(1_500_000n, DEVUSD_WORDS)).toBe("1.50 devUSD");
    const chips = thresholdChips(DEVUSD_WORDS);
    expect(chips.map((chip) => chip.label)).toEqual([
      "100k devUSD",
      "500k devUSD",
      "1M devUSD",
      "2.5M devUSD",
    ]);
    expect(chips.map((chip) => chip.base)).toEqual(
      thresholdChips(USDC_WORDS).map((chip) => chip.base),
    );
    const words = [
      ...chips.map((chip) => `${chip.label} ${thresholdWords(chip.base, DEVUSD_WORDS)}`),
      ...Array.from({ length: 17 }, (_, code) => proofErrorWords(code, DEVUSD_WORDS)),
    ].join(" ");
    expect(words).not.toMatch(/USDC|\$/);
    expect(proofErrorWords(3, DEVUSD_WORDS)).toBe(
      "Your wdevUSD account is not a Token-2022 account.",
    );
  });

  it("parses a custom amount as dollars and refuses what is not one", () => {
    expect(parseThreshold("250000")).toBe(250_000n * USDC);
    expect(parseThreshold("$250,000")).toBe(250_000n * USDC);
    expect(parseThreshold("7.5")).toBe(7_500_000n);
    for (const bad of ["", "0", "-5", "abc", "1.0000001", "1e6"]) {
      expect(parseThreshold(bad)).toBeNull();
    }
  });

  it("counts the expiry from now, within the program's 365 days", () => {
    const now = new Date("2026-09-30T10:00:00Z");
    expect(expiryFrom(now, 30)).toBe(BigInt(Date.UTC(2026, 9, 30, 10) / 1000));
    for (const option of VALIDITY_OPTIONS) {
      expect(option.days).toBeGreaterThan(0);
      expect(option.days).toBeLessThanOrEqual(365);
    }
  });

  it("reads a record's state and validity as the chain shows them", () => {
    const now = new Date("2026-09-30T10:00:00Z");
    expect(recordState({ exists: true, expiry: "2026-10-30T10:00:00Z" }, now)).toBe("valid");
    expect(recordState({ exists: true, expiry: "2026-09-30T10:00:00Z" }, now)).toBe("expired");
    expect(recordState({ exists: false, expiry: "2026-10-30T10:00:00Z" }, now)).toBe("closed");
    expect(expiryWords("2026-10-30T10:00:00Z", now)).toBe("Valid until 30 Oct 2026");
    expect(expiryWords("2026-09-29T10:00:00Z", now)).toBe("Expired on 29 Sep 2026");
    expect(verifyPath("EsVM5jHqyNVyVypQNRs3UFieQhJx1NBaF2idHHNxTGHy")).toBe(
      "/v/EsVM5jHqyNVyVypQNRs3UFieQhJx1NBaF2idHHNxTGHy",
    );
  });

  it("has plain words for every error of the program", () => {
    const words = Array.from({ length: 17 }, (_, code) => proofErrorWords(code, USDC_WORDS));
    expect(new Set(words).size).toBe(17);
    expect(proofErrorWords(12, USDC_WORDS)).toBe(
      "Your balance changed after the proof was made, so it no longer matches.",
    );
    expect(proofErrorWords(99, USDC_WORDS)).toBe(
      "The proof program refused the transaction with error 99.",
    );
  });

  it("hashes the counterparty on the server exactly as the tab does", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    for (const label of ["Hollis Supply Co.", "Şişli Bankası", "x"]) {
      expect(counterpartyHashOf(salt, label)).toEqual(await counterpartyHash(salt, label));
    }
  });
});
