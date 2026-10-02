// The brand kit's logos (step 4.2.1; design/brand-kit/BRAND-GUIDELINES.md): each component draws
// exactly the outlined shapes of its SVG file, in the file's own color, with no text, keeps the file's
// proportions, and names Sotto unless it is decorative inside a link that already does.
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SottoLockupInk,
  SottoLockupWhite,
  SottoMarkInk,
  SottoWordmarkWhite,
} from "../src/index.ts";

const KIT = new URL("../../../design/brand-kit/logos/svg/", import.meta.url);
const CASES = [
  { Component: SottoLockupInk, file: "sotto-lockup-ink.svg", color: "#0B1830" },
  { Component: SottoLockupWhite, file: "sotto-lockup-white.svg", color: "#FFFFFF" },
  { Component: SottoMarkInk, file: "sotto-mark-ink.svg", color: "#0B1830" },
  { Component: SottoWordmarkWhite, file: "sotto-wordmark-white.svg", color: "#FFFFFF" },
];

describe("brand logos", () => {
  for (const { Component, file, color } of CASES) {
    it(`${file}: the file's shapes and color, no text, its proportions`, () => {
      const source = readFileSync(new URL(file, KIT), "utf8");
      const html = renderToStaticMarkup(<Component height={28} />);
      const shapes = (svg: string) => [...svg.matchAll(/\bd="([^"]+)"/g)].map((m) => m[1]);
      expect(shapes(html)).toEqual(shapes(source));
      expect(shapes(html).length).toBeGreaterThan(0);
      expect(html).not.toContain("<text");
      const fills = new Set(
        [...html.matchAll(/(?:fill|stroke)="(#[0-9A-F]{6})"/g)].map((m) => m[1]),
      );
      expect([...fills]).toEqual([color]);
      const [, , w, h] = (/viewBox="([^"]+)"/.exec(source)?.[1] ?? "").split(/\s+/).map(Number);
      expect(html).toContain(`width="${(28 * (w ?? 0)) / (h ?? 1)}"`);
      expect(html).toContain('role="img"');
      expect(html).toContain('aria-label="Sotto"');
    });
  }

  it("is hidden from assistive technology when decorative", () => {
    const html = renderToStaticMarkup(<SottoLockupWhite height={28} decorative />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("aria-label");
  });
});
