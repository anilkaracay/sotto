// "Get ready to pay" (step 4.11, D-38): the checklist's rules. Six steps in order, exactly one in turn
// with one button and what the wallet will ask; the last two read from the account's public
// counters, so the list stays complete after a reload with no key unlocked; and the public rule a
// page uses to say it is ready.
import { describe, expect, it } from "vitest";
import {
  firstPaymentHref,
  groupedWhole,
  READY_ORDER,
  READY_WHY,
  readyComplete,
  readySteps,
  readyToPay,
  readyTurn,
  type ReadyFacts,
} from "../lib/ready.ts";
import type { FaucetView } from "../lib/server/faucet.ts";
import type { SolFaucetView } from "../lib/server/sol-faucet.ts";

const WALLET = "7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L";
const SIG =
  "5B1L6sgtbhLdQ1Zr8mVh3XkYc2uJ7pNfW4aTqE9oGdRs6yHnKb3vCx8MzPjUeA2iFwQt7LgD4hSnV9rYkB1mXcZ";

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
const devusd = (over: Partial<FaucetView> = {}): FaucetView => ({
  wallet: WALLET,
  limit: "1000000000000",
  remaining: "1000000000000",
  mints: [],
  ...over,
});
/** A brand new wallet: nothing yet. */
const fresh = (over: Partial<ReadyFacts> = {}): ReadyFacts => ({
  sol: sol(),
  solLimited: false,
  devusd: devusd(),
  accountConfigured: false,
  viewingKeyRegistered: false,
  publicBase: null,
  publicWrapped: null,
  pendingCredits: null,
  appliedCredits: null,
  keysUnlocked: false,
  viewingUnlocked: false,
  busy: null,
  signatures: {},
  moveAmount: "100000",
  ...over,
});
const funded = sol({ balanceLamports: "50000000", state: "not_needed" });
const states = (facts: ReadyFacts) => readySteps(facts).map((step) => step.state);

describe("the checklist's steps", () => {
  it("are six, in the founder's order, each with why it is needed", () => {
    const steps = readySteps(fresh());
    expect(steps.map((step) => step.id)).toEqual([
      "sol",
      "account",
      "viewingKey",
      "devusd",
      "move",
      "apply",
    ]);
    expect(READY_ORDER).toHaveLength(6);
    for (const step of steps) {
      expect(step.why).toBe(READY_WHY[step.id]);
      expect(step.why.length).toBeGreaterThan(20);
      expect(step.why).not.toContain("\n");
    }
  });

  it("have exactly one step in turn, with one button, and every later step waiting", () => {
    const walk: [ReadyFacts, string, string][] = [
      [fresh(), "sol", "Get test SOL"],
      [fresh({ sol: funded }), "account", "Unlock my keys and set up the account"],
      [
        fresh({ sol: funded, accountConfigured: true, pendingCredits: 0n, appliedCredits: 0n }),
        "viewingKey",
        "Register public viewing key",
      ],
      [
        fresh({
          sol: funded,
          accountConfigured: true,
          viewingKeyRegistered: true,
          pendingCredits: 0n,
          appliedCredits: 0n,
        }),
        "devusd",
        "Get 1,000,000 devUSD",
      ],
      [
        fresh({
          sol: funded,
          accountConfigured: true,
          viewingKeyRegistered: true,
          publicBase: 1_000_000_000_000n,
          pendingCredits: 0n,
          appliedCredits: 0n,
        }),
        "move",
        "Move 100,000 devUSD",
      ],
      [
        fresh({
          sol: funded,
          accountConfigured: true,
          viewingKeyRegistered: true,
          publicBase: 900_000_000_000n,
          pendingCredits: 1n,
          appliedCredits: 0n,
        }),
        "apply",
        "Unlock my keys and apply",
      ],
    ];
    for (const [facts, id, button] of walk) {
      const steps = readySteps(facts);
      const active = steps.filter((step) => step.button !== null);
      expect(
        active.map((step) => step.id),
        id,
      ).toEqual([id]);
      expect(active[0]?.button).toBe(button);
      expect(active[0]?.approvals, id).toBeTruthy();
      expect(readyTurn(steps)?.id).toBe(id);
      const at = steps.findIndex((step) => step.id === id);
      expect(steps.slice(0, at).every((step) => step.state === "done")).toBe(true);
      expect(steps.slice(at + 1).every((step) => step.state === "waiting")).toBe(true);
      expect(readyComplete(steps)).toBe(false);
    }
  });

  it("say before each wallet prompt how many approvals to expect and what they are for", () => {
    const account = readySteps(fresh({ sol: funded }))[1];
    expect(account?.approvals).toContain("Your wallet will ask 4 times");
    expect(account?.approvals).toContain("three messages");
    expect(account?.approvals).toContain("one transaction");
    const unlocked = readySteps(fresh({ sol: funded, keysUnlocked: true }))[1];
    expect(unlocked?.button).toBe("Set up the account");
    expect(unlocked?.approvals).toContain("Your wallet will ask 2 times");
    const base = { sol: funded, accountConfigured: true, pendingCredits: 0n, appliedCredits: 0n };
    expect(readySteps(fresh({ ...base, viewingUnlocked: true }))[2]?.approvals).toContain(
      "Your wallet will ask once",
    );
    expect(readySteps(fresh(base))[2]?.approvals).toContain("Your wallet will ask 2 times");
    // The faucets need no approval, and say so.
    expect(readySteps(fresh())[0]?.approvals).toBe("No wallet approval: Sotto sends it.");
    const move = readySteps(
      fresh({ ...base, viewingKeyRegistered: true, publicBase: 5n, moveAmount: "2500.5" }),
    )[4];
    expect(move?.button).toBe("Move 2,500.5 devUSD");
    expect(move?.approvals).toContain("Your wallet will ask once");
    const apply = readySteps(
      fresh({ ...base, viewingKeyRegistered: true, pendingCredits: 1n, keysUnlocked: true }),
    )[5];
    expect(apply?.button).toBe("Apply pending balance");
    expect(apply?.approvals).toContain("Your wallet will ask once");
  });

  it("show a running step without a button, and a stuck one with its reason", () => {
    const sending = readySteps(
      fresh({
        sol: sol({
          state: "used",
          grants: [
            {
              id: "g",
              lamports: "50000000",
              status: "sent",
              signature: SIG,
              createdAt: "2026-10-10T10:00:00.000Z",
              refilling: false,
            },
          ],
        }),
      }),
    );
    expect(sending[0]).toMatchObject({ state: "running", button: null, signature: SIG });
    // The wallet is signing: the step in turn runs, whatever its own state was.
    const signing = readySteps(fresh({ sol: funded, busy: "account" }));
    expect(signing[1]).toMatchObject({ state: "running", button: null });
    // A request refused for a limit, the day's total, a refill: stuck, with no button.
    for (const facts of [
      fresh({ solLimited: true }),
      fresh({ sol: sol({ state: "daily_total" }) }),
      fresh({ sol: sol({ state: "refilling" }) }),
    ]) {
      const first = readySteps(facts)[0];
      expect(first).toMatchObject({ state: "stuck", button: null });
      expect(states(facts).slice(1)).toEqual(Array(5).fill("waiting"));
    }
    expect(readySteps(fresh({ sol: sol({ state: "refilling" }) }))[0]?.detail).toBe(
      "Test SOL is being refilled, try again later.",
    );
    // The day's devUSD is used and the wallet holds none.
    const used = readySteps(
      fresh({
        sol: funded,
        accountConfigured: true,
        viewingKeyRegistered: true,
        pendingCredits: 0n,
        appliedCredits: 0n,
        devusd: devusd({ remaining: "0" }),
      }),
    )[3];
    expect(used).toMatchObject({ state: "stuck", button: null });
  });

  it("take SOL from anywhere: a wallet that holds enough needs no faucet", () => {
    const steps = readySteps(
      fresh({ sol: sol({ balanceLamports: "50000000", state: "available" }) }),
    );
    expect(steps[0]).toMatchObject({
      state: "done",
      detail: "Your wallet holds 0.05 SOL, enough for fees.",
    });
  });

  it("are complete from public facts alone, with no key unlocked and no faucet read", () => {
    const done = fresh({
      sol: funded,
      devusd: null,
      accountConfigured: true,
      viewingKeyRegistered: true,
      publicBase: 900_000_000_000n,
      publicWrapped: 0n,
      pendingCredits: 0n,
      appliedCredits: 1n,
      keysUnlocked: false,
      viewingUnlocked: false,
    });
    expect(states(done)).toEqual(Array(6).fill("done"));
    expect(readyComplete(readySteps(done))).toBe(true);
    expect(readyTurn(readySteps(done))).toBeNull();
    // A payment that arrives later waits as pending: the list stays complete, the payment that
    // needs it applies it.
    expect(readyComplete(readySteps({ ...done, pendingCredits: 3n }))).toBe(true);
    // The steps' transactions of this visit are linked.
    const linked = readySteps({ ...done, signatures: { move: SIG, apply: SIG } });
    expect(linked[4]?.signature).toBe(SIG);
    expect(linked[5]?.signature).toBe(SIG);
  });
});

describe("the public rule a page uses", () => {
  it("is null until the account is read, then true only with the account, the key and a balance applied", () => {
    const all = {
      accountRead: true,
      accountConfigured: true,
      viewingKeyRegistered: true,
      appliedCredits: 1n,
    };
    expect(readyToPay({ ...all, accountRead: false })).toBeNull();
    expect(readyToPay(all)).toBe(true);
    expect(readyToPay({ ...all, accountConfigured: false })).toBe(false);
    expect(readyToPay({ ...all, viewingKeyRegistered: false })).toBe(false);
    expect(readyToPay({ ...all, appliedCredits: 0n })).toBe(false);
    expect(readyToPay({ ...all, appliedCredits: null })).toBe(false);
  });

  it("sends the finished list to the pay form with the demo recipient chosen", () => {
    expect(firstPaymentHref("org-1")).toBe(
      "/app/org-1/payments/new?to=E6FbeoKRFNcCuSGkbn6QJgGzwoNYfDeHELJLS5BLLkDB",
    );
    expect(groupedWhole("100000")).toBe("100,000");
    expect(groupedWhole("1000000.25")).toBe("1,000,000.25");
    expect(groupedWhole("999")).toBe("999");
  });
});
