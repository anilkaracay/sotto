import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "../src/log.ts";
import { redact } from "../src/redact.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

function lastLine(spy: { mock: { calls: unknown[][] } }): Record<string, unknown> {
  return JSON.parse(spy.mock.calls.at(-1)?.[0] as string) as Record<string, unknown>;
}

describe("worker log lines", () => {
  it("removes database URLs from text", () => {
    expect(redact("connect postgres://sotto:pw@127.0.0.1:56433/sotto failed")).toBe(
      "connect <database-url> failed",
    );
  });

  it("writes JSON with fixed keys that fields cannot overwrite", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    log("job_run", { event: "spoofed", level: "spoofed", job: "sas-issue", took: 5n });
    expect(lastLine(out)).toMatchObject({
      event: "job_run",
      level: "info",
      job: "sas-issue",
      took: "5",
    });
  });

  it("keeps the statement of a failed query but never its parameters or the row detail", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint_name: "orgs_owner_user_id_key",
      detail: "Key (owner_user_id)=(1) already exists.",
    });
    const error = new Error(
      'Failed query: update "orgs" set "attestation_address" = $1 where "orgs"."id" = $2\nparams: Northwind,postgres://u:p@h/d',
      { cause },
    );
    log("job_failed", { job: "sas-issue", error }, "error");
    const line = lastLine(err);
    expect(line.error).toEqual({
      name: "Error",
      message: 'Failed query: update "orgs" set "attestation_address" = $1 where "orgs"."id" = $2',
      cause: {
        name: "Error",
        message: "duplicate key value violates unique constraint",
        code: "23505",
        constraint: "orgs_owner_user_id_key",
      },
    });
    expect(JSON.stringify(line)).not.toMatch(/Northwind|postgres:|already exists/);
  });
});
