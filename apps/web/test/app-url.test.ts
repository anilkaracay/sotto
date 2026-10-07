// The sign in origin at build time (D-15): explicit everywhere, derived from VERCEL_URL
// only on Vercel preview deployments.
import { describe, expect, it } from "vitest";
import { buildAppUrl } from "../lib/app-url.ts";

describe("buildAppUrl", () => {
  it("uses an explicit NEXT_PUBLIC_APP_URL everywhere, as an origin", () => {
    expect(buildAppUrl({ NEXT_PUBLIC_APP_URL: "https://app.sotto.example/some/path" })).toBe(
      "https://app.sotto.example",
    );
    expect(
      buildAppUrl({
        NEXT_PUBLIC_APP_URL: "https://devnet.sotto.example",
        VERCEL: "1",
        VERCEL_TARGET_ENV: "preview",
        VERCEL_URL: "sotto-git-x.vercel.app",
      }),
    ).toBe("https://devnet.sotto.example");
    expect(() => buildAppUrl({ NEXT_PUBLIC_APP_URL: "not a url" })).toThrow(
      "NEXT_PUBLIC_APP_URL is not a valid URL",
    );
  });

  it("derives the origin from VERCEL_URL on Vercel preview deployments only", () => {
    expect(
      buildAppUrl({
        VERCEL: "1",
        VERCEL_TARGET_ENV: "preview",
        VERCEL_URL: "sotto-abc123.vercel.app",
      }),
    ).toBe("https://sotto-abc123.vercel.app");
  });

  it("fails the build in production, a custom environment such as devnet, or a malformed VERCEL_URL", () => {
    for (const env of [
      { VERCEL: "1", VERCEL_TARGET_ENV: "production", VERCEL_URL: "sotto.vercel.app" },
      { VERCEL: "1", VERCEL_TARGET_ENV: "devnet", VERCEL_URL: "sotto-devnet.vercel.app" },
      { VERCEL: "1", VERCEL_TARGET_ENV: "preview", VERCEL_URL: "https://sotto.vercel.app/x" },
      { VERCEL: "1", VERCEL_TARGET_ENV: "preview" },
    ]) {
      expect(() => buildAppUrl(env)).toThrow(/NEXT_PUBLIC_APP_URL must be set for the Vercel/);
    }
  });

  it("leaves it unset outside Vercel (local and CI builds read their env files)", () => {
    expect(buildAppUrl({})).toBeUndefined();
    expect(
      buildAppUrl({ VERCEL_URL: "ignored.vercel.app", VERCEL_TARGET_ENV: "preview" }),
    ).toBeUndefined();
  });
});
