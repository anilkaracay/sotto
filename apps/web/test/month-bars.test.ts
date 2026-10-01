// The month bars' y axis (step 3.7, M2): three round steps that reach the highest month, labels in
// whole units of the 6 decimal token.
import { describe, expect, it } from "vitest";
import { axisLabel, axisStep } from "../app/app/_components/month-bars.tsx";

describe("the month bars' axis", () => {
  it("takes a round step so three steps reach the highest month", () => {
    expect(axisStep(0)).toBe(0);
    expect(axisStep(7.800519)).toBe(3);
    expect(axisStep(60)).toBe(20);
    expect(axisStep(1_840_300)).toBe(800_000);
    expect(axisStep(9_400)).toBe(4_000);
    expect(axisStep(7_000)).toBe(2_500);
    for (const highest of [0.4, 3, 7.8, 60, 186_420, 1_840_300]) {
      expect(axisStep(highest) * 3).toBeGreaterThanOrEqual(highest);
      expect(highest / (axisStep(highest) * 3)).toBeGreaterThan(0.6);
    }
  });

  it("writes the labels short", () => {
    expect(axisLabel(0)).toBe("0");
    expect(axisLabel(2.5)).toBe("2.5");
    expect(axisLabel(750)).toBe("750");
    expect(axisLabel(12_000)).toBe("12k");
    expect(axisLabel(1_500_000)).toBe("1.5M");
  });
});
