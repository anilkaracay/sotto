// GET /api/health (08 section 3).
import type { TestDatabase } from "@sotto/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "../app/api/health/route.ts";
import { closeDbClients } from "../lib/server/db.ts";
import { apiRequest, setUpApiTest, tearDownApiTest } from "./helpers/api.ts";

let test: TestDatabase;
beforeAll(async () => {
  test = await setUpApiTest();
});
afterAll(async () => {
  await tearDownApiTest(test);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("reports ok without a session or Origin, with a request ID and one log line", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await GET(apiRequest("/api/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "ok" });
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const line = JSON.parse(out.mock.calls.at(-1)?.[0] as string);
    expect(line).toMatchObject({
      event: "api_request",
      method: "GET",
      path: "/api/health",
      status: 200,
    });
  });

  it("reports degraded (503) when the database is unreachable, without connection details", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:hidden-pw@127.0.0.1:1/none");
    const response = await GET(apiRequest("/api/health"));
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ status: "degraded", database: "unavailable" });
    expect(text).not.toContain("hidden-pw");
    await closeDbClients();
    vi.stubEnv("DATABASE_URL", test.url);
  });
});
