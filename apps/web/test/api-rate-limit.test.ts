// Rate limits against a test database (08 sections 3 and 6).
import { rateLimits } from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clientIp,
  consumeRateLimit,
  RATE_LIMITS,
  rateLimitKey,
  type RateLimitPolicy,
} from "../lib/server/rate-limit.ts";
import { apiRequest, SESSION_SECRET, setUpApiTest, tearDownApiTest } from "./helpers/api.ts";

let test: TestDatabase;
beforeAll(async () => {
  test = await setUpApiTest();
});
afterAll(async () => {
  await tearDownApiTest(test);
});

const policy: RateLimitPolicy = { name: "test", limit: 3, windowSeconds: 60, by: "session" };

describe("consumeRateLimit", () => {
  it("allows the limit, refuses the next request and resets in the next window", async () => {
    const start = Date.UTC(2026, 8, 28, 12, 0, 0);
    const results = [];
    for (let i = 0; i < 4; i++)
      results.push(await consumeRateLimit(test.db, policy, "s1", SESSION_SECRET, start + i * 1000));
    expect(results.map((r) => [r.allowed, r.count])).toEqual([
      [true, 1],
      [true, 2],
      [true, 3],
      [false, 4],
    ]);
    expect(results[3]?.retryAfterSeconds).toBe(57);
    const next = await consumeRateLimit(test.db, policy, "s1", SESSION_SECRET, start + 60_000);
    expect([next.allowed, next.count]).toEqual([true, 1]);
  });

  it("counts subjects and policies separately and stores only HMAC keys", async () => {
    const now = Date.UTC(2026, 8, 28, 13, 0, 0);
    await consumeRateLimit(test.db, policy, "subject-a", SESSION_SECRET, now);
    expect((await consumeRateLimit(test.db, policy, "subject-b", SESSION_SECRET, now)).count).toBe(
      1,
    );
    expect(
      (
        await consumeRateLimit(
          test.db,
          { ...policy, name: "other" },
          "subject-a",
          SESSION_SECRET,
          now,
        )
      ).count,
    ).toBe(1);
    const keys = (await test.db.select({ key: rateLimits.key }).from(rateLimits)).map(
      (row) => row.key,
    );
    expect(keys).toContain(rateLimitKey(policy, "subject-a", SESSION_SECRET));
    expect(keys.join(" ")).not.toContain("subject-a");
  });

  it("reads the client IP from x-forwarded-for, then x-real-ip", () => {
    expect(
      clientIp(apiRequest("/", { headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } })),
    ).toBe("203.0.113.7");
    expect(clientIp(apiRequest("/", { headers: { "x-real-ip": "198.51.100.2" } }))).toBe(
      "198.51.100.2",
    );
    expect(clientIp(apiRequest("/"))).toBe("unknown");
  });

  it("uses the documented defaults", () => {
    expect(RATE_LIMITS).toEqual({
      authIp: { name: "auth-ip", limit: 20, windowSeconds: 60, by: "ip" },
      writeSession: { name: "write-session", limit: 60, windowSeconds: 60, by: "session" },
      writeIp: { name: "write-ip", limit: 120, windowSeconds: 60, by: "ip" },
      rpcSession: { name: "rpc-session", limit: 600, windowSeconds: 60, by: "session" },
    });
  });
});
