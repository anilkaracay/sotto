// The landing's quick nav section (F-17, step 3.1), from design/sotto-landing.html.

export function QuickNav() {
  return (
    <div className="snav" aria-label="Quick navigation">
      <a className="slogo" href="#v8top">
        <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
          <circle cx="13" cy="13" r="11" fill="none" stroke="#0B1830" strokeWidth="1.8" />
          <path d="M13 2a11 11 0 000 22z" fill="#0B1830" />
        </svg>
        <span>{"Sotto"}</span>
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
