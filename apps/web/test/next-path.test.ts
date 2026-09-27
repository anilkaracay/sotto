// Where sign in goes afterwards (step 1.8): an app path such as an invite link, never another site.
import { describe, expect, it } from "vitest";
import { safeNextPath } from "../lib/next-path.ts";

describe("sign in next path", () => {
  it("accepts plain paths under /app and turns everything else into /app", () => {
    for (const path of [
      "/app",
      "/app/",
      "/app/invite/AbC_123-xyz",
      "/app/0b8f3c3e-5d53-4d4e-9d7f-0f3f2d1c0a11/setup",
    ]) {
      expect(safeNextPath(path)).toBe(path);
    }
    for (const path of [
      null,
      undefined,
      "",
      "https://evil.example/app",
      "//evil.example/app",
      "/app//evil.example",
      "/app/../admin",
      "/application",
      "/app/invite/x?y=1",
      "/app/invite/%2F%2Fevil",
      `/app/${"a".repeat(300)}`,
      "/",
    ]) {
      expect(safeNextPath(path), String(path)).toBe("/app");
    }
  });
});
