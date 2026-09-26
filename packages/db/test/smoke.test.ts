import { describe, expect, it } from "vitest";
import { packageName } from "../src/index.ts";

describe("@sotto/db", () => {
  it("loads", () => {
    expect(packageName).toBe("@sotto/db");
  });
});
