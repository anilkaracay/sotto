// Request access (F-17, AC-17.2; step 3.2): POST /api/waitlist stores the work email (lowercased) and
// the company with the time of the visitor's explicit consent, once per email, sends nothing, answers
// a repeated email like a new one, refuses a request without consent or with a malformed field,
// another origin and more than 10 an hour from one address, and never writes the email to a log.
import { waitlist } from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/waitlist/route.ts";
import { apiRequest, errorOf, jsonRequest, setUpApiTest, tearDownApiTest } from "./helpers/api.ts";

let test: TestDatabase;
let logged: string[] = [];

beforeAll(async () => {
  test = await setUpApiTest();
});
afterAll(async () => {
  await tearDownApiTest(test);
});
beforeEach(async () => {
  logged = [];
  for (const method of ["log", "info", "warn", "error"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  }
  await test.db.delete(waitlist);
});

const post = (body: unknown) => POST(jsonRequest("/api/waitlist", "POST", null, body));

describe("request access (AC-17.2)", () => {
  it("AC-17.2 stores the work email and company with the time of the visitor's consent", async () => {
    const before = Date.now();
    const response = await post({
      email: "Maya@Northwind.example",
      company: "  Northwind  ",
      consent: true,
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    const rows = await test.db.select().from(waitlist);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: "maya@northwind.example", company: "Northwind" });
    expect(rows[0]?.consentAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    // I-2 in spirit for personal data: the email is in no log line.
    expect(logged.join("\n").toLowerCase()).not.toContain("maya@northwind.example");
  });

  it("AC-17.2 answers a repeated email like a new one and keeps one row", async () => {
    expect(
      (await post({ email: "idris@acme.example", company: "Acme", consent: true })).status,
    ).toBe(201);
    expect(
      (await post({ email: "IDRIS@acme.example", company: "Acme Two", consent: true })).status,
    ).toBe(201);
    const rows = await test.db.select().from(waitlist);
    expect(rows.map((row) => [row.email, row.company])).toEqual([["idris@acme.example", "Acme"]]);
  });

  it("AC-17.2 refuses a request without consent or with a malformed field", async () => {
    for (const [body, field] of [
      [{ email: "a@b.example", company: "Acme", consent: false }, "consent"],
      [{ email: "a@b.example", company: "Acme" }, "consent"],
      [{ email: "not an email", company: "Acme", consent: true }, "email"],
      [{ email: "a@b.example", company: "", consent: true }, "company"],
      [{ email: "a@b.example", company: "x".repeat(121), consent: true }, "company"],
      [{ email: "a@b.example", company: "Acme\u0007", consent: true }, "company"],
    ] as const) {
      const response = await post(body);
      expect(response.status).toBe(400);
      expect((await errorOf(response)).message).toContain(field);
    }
    const extra = await post({ email: "a@b.example", company: "Acme", consent: true, note: "hi" });
    expect(extra.status).toBe(400);
    expect(await test.db.select().from(waitlist)).toEqual([]);
  });

  it("AC-17.2 refuses another origin and more than 10 requests an hour from one address", async () => {
    const foreign = await POST(
      apiRequest("/api/waitlist", {
        method: "POST",
        body: JSON.stringify({ email: "a@b.example", company: "Acme", consent: true }),
        headers: { origin: "https://elsewhere.example", "content-type": "application/json" },
      }),
    );
    expect(foreign.status).toBe(403);
    const from = (i: number) =>
      POST(
        apiRequest("/api/waitlist", {
          method: "POST",
          body: JSON.stringify({ email: `p${i}@b.example`, company: "Acme", consent: true }),
          headers: {
            origin: "http://localhost:3000",
            "content-type": "application/json",
            "x-forwarded-for": "203.0.113.77",
          },
        }),
      );
    for (let i = 0; i < 10; i++) expect((await from(i)).status).toBe(201);
    const over = await from(10);
    expect(over.status).toBe(429);
    expect((await errorOf(over)).code).toBe("rate_limited");
  });
});
