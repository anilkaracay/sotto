// The first-run card's steps (step 4.6, D-33): test SOL when the wallet needs it, the confidential
// account, then 1,000,000 devUSD, in that order, each with its state and its transaction.
import { describe, expect, it } from "vitest";
import {
  FIRST_RUN_DEVUSD,
  firstRunDevusdAmount,
  firstRunDone,
  firstRunSteps,
  solWords,
  type FirstRunFacts,
} from "../lib/first-run.ts";
import type { FaucetView } from "../lib/server/faucet.ts";
import type { SolFaucetView } from "../lib/server/sol-faucet.ts";

const WALLET = "8QJKvfopCqqDHEGfp5Lf4m8SCC1uQGWpZa8YC8L6tVJn";
const sol = (over: Partial<SolFaucetView> = {}): SolFaucetView => ({
  wallet: WALLET,
  grantLamports: "50000000",
  ceilingLamports: "20000000",
  balanceLamports: "0",
  state: "available",
  nextAt: null,
  grants: [],
  ...over,
});
const grant = (
  status: "pending" | "sent" | "paid" | "failed",
  signature: string | null = null,
) => ({
  id: "g",
  lamports: "50000000",
  status,
  signature,
  refilling: false,
  createdAt: "2026-10-09T12:00:00.000Z",
});
const devusd = (over: Partial<FaucetView> = {}): FaucetView => ({
  wallet: WALLET,
  limit: "1000000000000",
  remaining: "1000000000000",
  mints: [],
  ...over,
});
const mint = (
  status: "pending" | "sent" | "minted" | "failed",
  signature: string | null = null,
) => ({
  id: "m",
  amount: "1000000000000",
  status,
  signature,
  createdAt: "2026-10-09T12:01:00.000Z",
});
const facts = (over: Partial<FirstRunFacts> = {}): FirstRunFacts => ({
  sol: sol(),
  devusd: devusd(),
  accountConfigured: false,
  accountBusy: false,
  accountSignature: null,
  ...over,
});
const states = (input: FirstRunFacts) =>
  firstRunSteps(input).map((step) => `${step.id}: ${step.state}`);

describe("the first-run card's steps", () => {
  it("run in order for a new wallet: test SOL, then the account, then the test dollars", () => {
    expect(firstRunSteps(facts()).map((step) => step.title)).toEqual([
      "Test SOL for fees",
      "Confidential account",
      "1,000,000 devUSD",
    ]);
    // Nothing is read yet.
    expect(states(facts({ sol: null, devusd: null }))).toEqual([
      "sol: waiting",
      "account: waiting",
      "devusd: waiting",
    ]);
    // An empty wallet: SOL first; the account waits for it, the dollars for the account.
    expect(states(facts())).toEqual(["sol: ready", "account: waiting", "devusd: waiting"]);
    expect(states(facts({ sol: sol({ state: "used", grants: [grant("sent", "5sig")] }) }))).toEqual(
      ["sol: running", "account: waiting", "devusd: waiting"],
    );
    const paid = sol({
      state: "used",
      balanceLamports: "50000000",
      grants: [grant("paid", "5sig")],
    });
    expect(states(facts({ sol: paid }))).toEqual([
      "sol: done",
      "account: ready",
      "devusd: waiting",
    ]);
    expect(states(facts({ sol: paid, accountBusy: true }))).toEqual([
      "sol: done",
      "account: running",
      "devusd: waiting",
    ]);
    const set = facts({ sol: paid, accountConfigured: true, accountSignature: "4setup" });
    expect(states(set)).toEqual(["sol: done", "account: done", "devusd: ready"]);
    expect(
      states({ ...set, devusd: devusd({ remaining: "0", mints: [mint("pending")] }) }),
    ).toEqual(["sol: done", "account: done", "devusd: running"]);
    const all = firstRunSteps({
      ...set,
      devusd: devusd({ remaining: "0", mints: [mint("minted", "3mint")] }),
    });
    expect(all.map((step) => step.state)).toEqual(["done", "done", "done"]);
    expect(firstRunDone(all)).toBe(true);
    // Each step carries its transaction, for "Verify on Solana".
    expect(all.map((step) => step.signature)).toEqual(["5sig", "4setup", "3mint"]);
    expect(firstRunDone(firstRunSteps(set))).toBe(false);
  });

  it("skips the SOL step for a wallet that holds enough, and says so", () => {
    const [step, account] = firstRunSteps(
      facts({ sol: sol({ state: "not_needed", balanceLamports: "1250000000" }) }),
    );
    expect(step).toMatchObject({
      state: "done",
      detail: "Your wallet holds 1.25 SOL, enough for fees.",
      signature: null,
    });
    expect(account?.state).toBe("ready");
  });

  it("says politely when test SOL is being refilled or given out for the day, and goes on if the wallet has some", () => {
    const refilling = firstRunSteps(facts({ sol: sol({ state: "refilling" }) }));
    expect(refilling[0]).toMatchObject({
      state: "stuck",
      detail: "Test SOL is being refilled, try again later.",
    });
    expect(refilling[1]?.state).toBe("waiting");
    const day = firstRunSteps(facts({ sol: sol({ state: "daily_total" }) }));
    expect(day[0]?.detail).toContain("Get devnet SOL at faucet.solana.com");
    // 0.01 SOL is under the faucet's line but enough for the account's setup.
    const some = firstRunSteps(
      facts({ sol: sol({ state: "refilling", balanceLamports: "10000000" }) }),
    );
    expect(some.map((step) => step.state)).toEqual(["stuck", "ready", "waiting"]);
  });

  it("asks for 1,000,000 devUSD, or for what the wallet's day has left", () => {
    expect(FIRST_RUN_DEVUSD).toBe(1_000_000_000_000n);
    expect(firstRunDevusdAmount(devusd())).toBe(1_000_000_000_000n);
    expect(firstRunDevusdAmount(devusd({ remaining: "250000000000" }))).toBe(250_000_000_000n);
    const none = firstRunSteps(
      facts({
        sol: sol({ state: "not_needed", balanceLamports: "100000000" }),
        accountConfigured: true,
        devusd: devusd({ remaining: "0" }),
      }),
    );
    expect(none[2]).toMatchObject({
      state: "stuck",
      detail: "Your wallet got its devUSD for these 24 hours. Try again tomorrow.",
    });
    // A mint that failed does not count: the step is its turn again.
    expect(
      firstRunSteps(
        facts({
          sol: sol({ state: "not_needed", balanceLamports: "100000000" }),
          accountConfigured: true,
          devusd: devusd({ mints: [mint("failed")] }),
        }),
      )[2]?.state,
    ).toBe("ready");
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
