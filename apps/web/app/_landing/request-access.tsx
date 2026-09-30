// Request access on the landing's footer (F-17, 13 L24; step 3.1): "Work email" and "Company" in the
// design's pill form. Storing the request comes with step 3.2 (AC-17.2); until then the button is
// disabled, so the page never offers an action that does nothing.
export function RequestAccessForm() {
  return (
    <div className="form" data-testid="request-access">
      <label className="sr" htmlFor="v8email">
        Work email
      </label>
      <input id="v8email" type="email" placeholder="you@company.com" autoComplete="email" />
      <label className="sr" htmlFor="v8company">
        Company
      </label>
      <input id="v8company" type="text" placeholder="Company" autoComplete="organization" />
      <button type="button" className="b b-ink" disabled>
        Request access
      </button>
    </div>
  );
}
