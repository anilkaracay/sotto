import { describe, expect, it } from "vitest";
import { main } from "../src/main.ts";

describe("@sotto/worker", () => {
  it("starts and exits cleanly", () => {
    expect(main()).toBe(0);
  });
});
