// The landing's quick nav section (F-17, step 3.1), from design/sotto-landing.html; the logo is the
// brand kit's lockup since step 4.2.1 (27 pixels tall, 99 wide, above the 96 pixel minimum).
import { SottoLockupInk } from "@sotto/ui";

export function QuickNav() {
  return (
    <div className="snav" aria-label="Quick navigation">
      <a className="slogo" href="#v8top">
        <SottoLockupInk height={27} />
      </a>
      <nav>
        <a href="#v8views">{"Product"}</a>
        <a href="#v8uses">{"Use cases"}</a>
        <a href="#v8proof">{"Proofs"}</a>
        <a href="#v8trust">{"Trust"}</a>
        <a href="#v8faq">{"FAQ"}</a>
      </nav>
      <a className="b b-ink" href="#v8access">
        {"Request access"}
      </a>
    </div>
  );
}
