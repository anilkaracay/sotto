import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { themeClass } from "../src/index.ts";

describe("@sotto/ui themes", () => {
  it("scopes each theme file to its class", () => {
    const landing = readFileSync(new URL("../theme-landing.css", import.meta.url), "utf8");
    const app = readFileSync(new URL("../theme-app.css", import.meta.url), "utf8");
    expect(landing).toContain(`.${themeClass.landing} {`);
    expect(app).toContain(`.${themeClass.app} {`);
  });
});
