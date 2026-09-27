// The recipients page's readiness cell (step 1.8, component level): the chip and, for recipients who
// are not ready, why they cannot be paid confidentially (AC-07.4).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReadinessCell } from "../app/app/[org]/recipients/readiness-cell.tsx";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("recipient readiness cell", () => {
  it("AC-07.4 shows that a recipient who is not ready cannot be paid confidentially, and why", () => {
    const none = renderToStaticMarkup(<ReadinessCell readiness="no_account" />);
    expect(none).toContain('data-readiness="no_account"');
    expect(text(none)).toBe(
      "No account Cannot be paid confidentially yet: there is no wUSDC account at this wallet. Their invite link walks them through setting one up.",
    );
    const plain = text(renderToStaticMarkup(<ReadinessCell readiness="not_configured" />));
    expect(plain).toMatch(/^Not set up Cannot be paid confidentially yet: /);
    const ready = text(renderToStaticMarkup(<ReadinessCell readiness="ready" />));
    expect(ready).toBe(
      "Ready Ready: the wUSDC account at this wallet can receive confidential payments.",
    );
  });
});
