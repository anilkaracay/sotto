// The run page's settlement gauge (step 2.3, component level; design .rd2, AC-08.4): as many
// ticks as lines from 12 to 48, lit one per settled line, with the settled count and its line.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Gauge } from "../app/app/[org]/payroll/[run]/run-panel.tsx";

const ticks = (html: string) => (html.match(/<line /g) ?? []).length;
const lit = (html: string) => (html.match(/<line [^>]*class="[^"]+"/g) ?? []).length;

describe("settlement gauge", () => {
  it("AC-08.4 draws a tick per line and lights one per settled line", () => {
    const html = renderToStaticMarkup(
      <Gauge
        lines={24}
        settled={11}
        head="11 of 24 paid"
        sub="Resume to pay the lines that did not settle"
      />,
    );
    expect(ticks(html)).toBe(24);
    expect(lit(html)).toBe(11);
    expect(html).toContain('data-lit="11"');
    expect(html).toContain("11 of 24 paid");
  });

  it("AC-08.4 keeps at least 12 ticks and at most 48, and is full only when every line settled", () => {
    expect(ticks(renderToStaticMarkup(<Gauge lines={3} settled={0} head="" sub="" />))).toBe(12);
    const few = renderToStaticMarkup(<Gauge lines={3} settled={3} head="" sub="" />);
    expect(lit(few)).toBe(12);
    const many = renderToStaticMarkup(<Gauge lines={96} settled={95} head="" sub="" />);
    expect(ticks(many)).toBe(48);
    expect(lit(many)).toBe(47);
  });
});
