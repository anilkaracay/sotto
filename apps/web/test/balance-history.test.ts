// The balance history (AC-05.2, 07 section 6; step 2.12): one bar per month over the last six months,
// each the month's last snapshot adjusted by the public deposits and withdrawals after it within the
// month; a month without a snapshot builds on the last known balance only when it has public flows;
// a month with neither has no bar; a history shorter than six months shows only its months.
import { describe, expect, it } from "vitest";
import {
  balanceHistory,
  historySince,
  shiftMonth,
  type BalanceSnapshot,
  type PublicFlow,
} from "../lib/balance-history.ts";

const USDC = 1_000_000n;
const NOW = new Date("2026-09-30T12:00:00Z");
/** Whole USDC in the tests, base units in the history. */
const snap = (at: string, available: number, pending = 0): BalanceSnapshot => ({
  day: at.slice(0, 10),
  at,
  available: BigInt(available) * USDC,
  pending: BigInt(pending) * USDC,
});
const flow = (at: string, type: PublicFlow["type"], amount: number): PublicFlow => ({
  at,
  type,
  amount: BigInt(amount) * USDC,
});
const bars = (history: ReturnType<typeof balanceHistory>) =>
  history.kind === "history"
    ? history.months.map((entry) => [
        entry.month,
        entry.balance === null ? null : entry.balance / USDC,
      ])
    : history.kind;

describe("balance history (AC-05.2)", () => {
  it("AC-05.2 takes each month's last snapshot, then the public deposits and withdrawals after it that month", () => {
    const history = balanceHistory({
      snapshots: [
        snap("2026-04-03T09:00:00.000Z", 100, 20),
        snap("2026-04-20T09:00:00.000Z", 150, 10),
        snap("2026-06-02T09:00:00.000Z", 90),
        snap("2026-09-30T08:00:00.000Z", 70, 5),
      ],
      flows: [
        // Before April's last snapshot: already in it.
        flow("2026-04-10T10:00:00.000Z", "deposit", 1000),
        // After it within April: added and taken away.
        flow("2026-04-25T10:00:00.000Z", "deposit", 40),
        flow("2026-04-28T10:00:00.000Z", "withdraw", 15),
        // July has no snapshot: June's balance plus July's flows.
        flow("2026-07-15T10:00:00.000Z", "deposit", 30),
        // September: after the day's snapshot.
        flow("2026-09-30T10:00:00.000Z", "withdraw", 25),
      ],
      now: NOW,
    });
    expect(bars(history)).toEqual([
      ["2026-04", 185n],
      ["2026-05", null],
      ["2026-06", 90n],
      ["2026-07", 120n],
      ["2026-08", null],
      ["2026-09", 50n],
    ]);
    expect(history).toMatchObject({ startsOn: null, latest: "2026-09" });
  });

  it("AC-05.2 never extrapolates: no bar for a month with neither a snapshot nor public flows, nor for flows before the first snapshot", () => {
    const history = balanceHistory({
      snapshots: [snap("2026-08-10T09:00:00.000Z", 60)],
      flows: [
        flow("2026-08-01T10:00:00.000Z", "deposit", 500),
        flow("2026-08-11T10:00:00.000Z", "deposit", 5),
      ],
      now: NOW,
    });
    expect(bars(history)).toEqual([
      ["2026-08", 65n],
      ["2026-09", null],
    ]);
    expect(history).toMatchObject({ latest: "2026-08" });
  });

  it("AC-05.2 shows only the months that exist when the history is shorter than six months, with its first day", () => {
    const history = balanceHistory({
      snapshots: [snap("2026-09-30T08:00:00.000Z", 32)],
      flows: [],
      now: NOW,
    });
    expect(bars(history)).toEqual([["2026-09", 32n]]);
    expect(history).toMatchObject({ startsOn: "2026-09-30", latest: "2026-09" });
    // An older snapshot exists beyond what the page read: the full six months, no start day.
    const longer = balanceHistory({
      snapshots: [snap("2026-09-30T08:00:00.000Z", 32)],
      flows: [],
      now: NOW,
      startedBefore: true,
    });
    expect(bars(longer)).toEqual([
      ["2026-04", null],
      ["2026-05", null],
      ["2026-06", null],
      ["2026-07", null],
      ["2026-08", null],
      ["2026-09", 32n],
    ]);
    expect(longer).toMatchObject({ startsOn: null });
  });

  it("AC-05.2 is empty without a snapshot, even with public flows", () => {
    expect(
      balanceHistory({
        snapshots: [],
        flows: [flow("2026-09-01T10:00:00.000Z", "deposit", 10)],
        now: NOW,
      }),
    ).toEqual({ kind: "empty" });
  });

  it("AC-05.2 carries the month before the window into its first month and keeps six bars at most", () => {
    const history = balanceHistory({
      snapshots: [snap("2026-03-20T09:00:00.000Z", 10), snap("2026-09-01T09:00:00.000Z", 44)],
      flows: [flow("2026-04-05T10:00:00.000Z", "deposit", 3)],
      now: NOW,
    });
    expect(bars(history)).toEqual([
      ["2026-04", 13n],
      ["2026-05", null],
      ["2026-06", null],
      ["2026-07", null],
      ["2026-08", null],
      ["2026-09", 44n],
    ]);
    expect(historySince(NOW)).toBe("2026-03-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
  });
});
