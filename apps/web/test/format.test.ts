import { describe, expect, it } from "vitest";
import { formatDate, shortWallet } from "../lib/format.ts";

describe("display helpers", () => {
  it("formats dates in UTC with fixed month names", () => {
    expect(formatDate(new Date("2026-09-27T23:30:00.000Z"))).toBe("27 Sep 2026");
    expect(formatDate("2026-01-01T00:00:00.000Z")).toBe("1 Jan 2026");
  });

  it("shortens a wallet to its first and last four characters", () => {
    expect(shortWallet("71GuHKz8HqEKvGbMwQQTiNpqQbMvEu89pSvUcv71QbLh")).toBe("71Gu…QbLh");
  });
});
