"use client";

// Request access on the landing's footer (F-17, AC-17.2, 13 L24; step 3.2): "Work email" and
// "Company" in the design's pill form and an explicit consent box. The request is stored by
// POST /api/waitlist; nothing is sent to the visitor (double opt in by email is Post-hackathon with
// D-19). Once stored, the form gives way to "Thanks, we will be in touch".
import { useId, useState, type FormEvent } from "react";
import { ApiCallError, callApi, invalidField } from "../../lib/client/api.ts";

type State = { kind: "idle"; problem: string | null } | { kind: "sending" } | { kind: "done" };

/** The consent sentence the visitor agrees to (13 L24). */
export const CONSENT_TEXT =
  "I agree that Sotto stores my work email and company to contact me about the beta.";
export const THANKS_TEXT = "Thanks, we will be in touch";

/** The words for a refused request: the field the API names, or its own message. */
export function requestProblem(error: unknown): string {
  if (!(error instanceof ApiCallError)) return "Sotto could not be reached. Try again.";
  if (error.code === "rate_limited") return "Too many requests from this network. Try again later.";
  const field = invalidField(error);
  if (field?.field === "email") return "Enter your work email.";
  if (field?.field === "company") return `Company: ${field.message}.`;
  if (field?.field === "consent") return "Tick the box to agree that Sotto stores your details.";
  return error.message;
}

export function RequestAccessForm() {
  const id = useId();
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle", problem: null });

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!consent) {
      setState({ kind: "idle", problem: "Tick the box to agree that Sotto stores your details." });
      return;
    }
    setState({ kind: "sending" });
    try {
      await callApi("/api/waitlist", { method: "POST", body: { email, company, consent: true } });
      setState({ kind: "done" });
    } catch (error) {
      setState({ kind: "idle", problem: requestProblem(error) });
    }
  }

  if (state.kind === "done") {
    return (
      <p className="fdone" role="status" data-testid="request-access-done">
        {THANKS_TEXT}
      </p>
    );
  }
  const problem = state.kind === "idle" ? state.problem : null;
  return (
    <form onSubmit={submit} noValidate data-testid="request-access">
      <div className="form">
        <label className="sr" htmlFor={`${id}-email`}>
          Work email
        </label>
        <input
          id={`${id}-email`}
          type="email"
          placeholder="you@company.com"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <label className="sr" htmlFor={`${id}-company`}>
          Company
        </label>
        <input
          id={`${id}-company`}
          type="text"
          placeholder="Company"
          autoComplete="organization"
          required
          value={company}
          onChange={(e) => setCompany(e.target.value)}
        />
        <button type="submit" className="b b-ink" disabled={state.kind === "sending"}>
          {state.kind === "sending" ? "Sending…" : "Request access"}
        </button>
      </div>
      <label className="fconsent">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span>{CONSENT_TEXT}</span>
      </label>
      {problem ? (
        <p className="fproblem" role="alert" data-testid="request-access-problem">
          {problem}
        </p>
      ) : null}
    </form>
  );
}
