// What a new wallet's first steps share (step 4.6, D-33): the amounts and the note that points to
// Solana's own faucet. The checklist's rules are in ready.test.ts.
import { describe, expect, it } from "vitest";
import {
  FIRST_RUN_DEVUSD,
  FIRST_RUN_MIN_SOL,
  SOL_ELSEWHERE_AFTER,
  SOL_ELSEWHERE_BEFORE,
  SOLANA_FAUCET_NAME,
  SOLANA_FAUCET_URL,
  solWords,
} from "../lib/first-run.ts";

describe("a new wallet's first steps", () => {
  it("asks for 1,000,000 devUSD and needs 0.005 SOL for the account's setup", () => {
    expect(FIRST_RUN_DEVUSD).toBe(1_000_000_000_000n);
    expect(solWords(FIRST_RUN_MIN_SOL)).toBe("0.005");
  });

  it("points to Solana's own faucet when Sotto's cannot send", () => {
    expect(SOLANA_FAUCET_URL).toBe("https://faucet.solana.com");
    expect(`${SOL_ELSEWHERE_BEFORE} ${SOLANA_FAUCET_NAME}${SOL_ELSEWHERE_AFTER}`).toBe(
      "Sotto's faucet cannot send this wallet test SOL right now. Get devnet SOL for it at faucet.solana.com, then reload this page.",
    );
  });

  it("writes SOL without trailing zeros", () => {
    expect([0n, 50_000_000n, 1_250_000_000n, 3_000_000_000n].map(solWords)).toEqual([
      "0",
      "0.05",
      "1.25",
      "3",
    ]);
  });
});
