import { describe, expect, it } from "vitest";
import eslintBase from "../eslint.config.js";
import prettier from "../prettier.config.js";

describe("@sotto/config", () => {
  it("exports a flat ESLint config and a Prettier config", () => {
    expect(Array.isArray(eslintBase)).toBe(true);
    expect(eslintBase.length).toBeGreaterThan(0);
    expect(prettier.printWidth).toBe(100);
  });
});
