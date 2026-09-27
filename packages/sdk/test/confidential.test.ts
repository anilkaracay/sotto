import { describe, expect, it } from "vitest";
import { formatTokenAmount } from "../src/confidential/index.ts";

describe("token amounts", () => {
  it("formats base units exactly, without floating point", () => {
    expect(formatTokenAmount(40_000_000n, 6)).toBe("40");
    expect(formatTokenAmount(12_345_678n, 6)).toBe("12.345678");
    expect(formatTokenAmount(40_500_000n, 6)).toBe("40.5");
    expect(formatTokenAmount(1n, 6)).toBe("0.000001");
    expect(formatTokenAmount(0n, 6)).toBe("0");
    expect(formatTokenAmount(18_446_744_073_709_551_615n, 6)).toBe("18446744073709.551615");
    expect(formatTokenAmount(7n, 0)).toBe("7");
    expect(formatTokenAmount(-1_500_000n, 6)).toBe("-1.5");
    expect(() => formatTokenAmount(1n, -1)).toThrow();
  });
});
