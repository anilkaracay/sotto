// POST /api/rpc (08 section 3): session, Origin check, method allow list, per session rate limit,
// body size limit, upstream error mapping; RPC_URL never leaves the server.
import { rateLimits } from "@sotto/db";
import type { TestDatabase } from "@sotto/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/rpc/route.ts";
import { RATE_LIMITS, rateLimitKey } from "../lib/server/rate-limit.ts";
import { RPC_MAX_BODY_BYTES, RPC_METHODS } from "../lib/server/rpc.ts";
import { sessionIdFromToken } from "../lib/server/session.ts";
import {
  APP_ORIGIN,
  apiRequest,
  createUserWithSession,
  RPC_URL,
  SESSION_SECRET,
  setUpApiTest,
  tearDownApiTest,
} from "./helpers/api.ts";

let test: TestDatabase;
let cookie: string;
let token: string;

beforeAll(async () => {
  test = await setUpApiTest();
  ({ cookie, token } = await createUserWithSession(test));
});
afterAll(async () => {
  await tearDownApiTest(test);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.stubEnv("RPC_URL", RPC_URL);
});

function rpc(body: unknown, headers: Record<string, string> = {}): Request {
  return apiRequest("/api/rpc", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { origin: APP_ORIGIN, "content-type": "application/json", cookie, ...headers },
  });
}

const blockhashCall = {
  jsonrpc: "2.0",
  id: 1,
  method: "getLatestBlockhash",
  params: [{ commitment: "confirmed" }],
};

function upstream(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function errorOf(response: Response): Promise<string> {
  const body = (await response.json()) as { error: { code: string } };
  return `${response.status} ${body.error.code}`;
}

describe("POST /api/rpc", () => {
  it("forwards an allowed method to RPC_URL and returns the upstream body without the URL", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = '{"jsonrpc":"2.0","id":1,"result":{"value":{"blockhash":"abc"}}}';
    const fetchMock = upstream(new Response(result, { status: 200 }));
    const response = await POST(rpc(blockhashCall));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe(result);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(RPC_URL);
    expect(init.body).toBe(JSON.stringify(blockhashCall));
    expect(JSON.stringify([...response.headers])).not.toContain("helius");
  });

  it("logs the method and status, never the upstream URL or the session token", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    upstream(new Response('{"jsonrpc":"2.0","id":1,"result":1}'));
    await POST(rpc(blockhashCall));
    const lines = out.mock.calls.map((call) => String(call[0])).join("\n");
    expect(lines).toContain('"rpcMethod":"getLatestBlockhash"');
    expect(lines).not.toContain("test-key-sentinel");
    expect(lines).not.toContain(token);
  });

  it("allows exactly the documented methods", () => {
    expect([...RPC_METHODS]).toEqual([
      "getAccountInfo",
      "getBalance",
      "getBlock",
      "getBlockHeight",
      "getGenesisHash",
      "getLatestBlockhash",
      "getMinimumBalanceForRentExemption",
      "getMultipleAccounts",
      "getRecentPrioritizationFees",
      "getSignatureStatuses",
      "getTokenAccountBalance",
      "getTransaction",
      "sendTransaction",
      "simulateTransaction",
    ]);
  });

  it("refuses methods outside the allow list (403) without calling upstream", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = upstream(new Response("{}"));
    for (const method of [
      "getProgramAccounts",
      "requestAirdrop",
      "getSignaturesForAddress",
      "sendTransactionX",
    ]) {
      expect(await errorOf(await POST(rpc({ jsonrpc: "2.0", id: 2, method, params: [] })))).toBe(
        "403 rpc_method_not_allowed",
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses batches, malformed requests and other content types", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = upstream(new Response("{}"));
    expect(await errorOf(await POST(rpc([blockhashCall])))).toBe("400 invalid_request");
    expect(await errorOf(await POST(rpc({ id: 1, method: "getBalance" })))).toBe(
      "400 invalid_request",
    );
    expect(await errorOf(await POST(rpc({ ...blockhashCall, extra: true })))).toBe(
      "400 invalid_request",
    );
    expect(await errorOf(await POST(rpc("{not json")))).toBe("400 invalid_request");
    expect(await errorOf(await POST(rpc(blockhashCall, { "content-type": "text/plain" })))).toBe(
      "415 unsupported_media_type",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a body over the size limit (413)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = upstream(new Response("{}"));
    const big = {
      jsonrpc: "2.0",
      id: 3,
      method: "sendTransaction",
      params: ["A".repeat(RPC_MAX_BODY_BYTES)],
    };
    expect(await errorOf(await POST(rpc(big)))).toBe("413 payload_too_large");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses requests without a session (401) or with a foreign or missing Origin (403)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = upstream(new Response("{}"));
    expect(await errorOf(await POST(rpc(blockhashCall, { cookie: "" })))).toBe(
      "401 unauthenticated",
    );
    expect(await errorOf(await POST(rpc(blockhashCall, { origin: "https://evil.example" })))).toBe(
      "403 forbidden_origin",
    );
    const noOrigin = apiRequest("/api/rpc", {
      method: "POST",
      body: JSON.stringify(blockhashCall),
      headers: { "content-type": "application/json", cookie },
    });
    expect(await errorOf(await POST(noOrigin))).toBe("403 forbidden_origin");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces the per session rate limit (429 with Retry-After)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchMock = upstream(new Response('{"jsonrpc":"2.0","id":1,"result":1}'));
    const limit = RATE_LIMITS.rpcSession;
    const windowMs = limit.windowSeconds * 1000;
    const key = rateLimitKey(limit, sessionIdFromToken(token, SESSION_SECRET), SESSION_SECRET);
    await test.db
      .insert(rateLimits)
      .values({
        key,
        windowStart: new Date(Math.floor(Date.now() / windowMs) * windowMs),
        count: limit.limit,
      })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: limit.limit,
          windowStart: new Date(Math.floor(Date.now() / windowMs) * windowMs),
        },
      });
    const response = await POST(rpc(blockhashCall));
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await response.json()) as unknown).toEqual({
      error: { code: "rate_limited", message: "Too many requests, retry later" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await test.db.delete(rateLimits);
  });

  it("maps upstream failures without leaking details", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    upstream(new Response("slow down", { status: 429 }));
    const busy = await POST(rpc(blockhashCall));
    expect(busy.statusText).toBe("Network busy, retrying");
    expect(await errorOf(busy)).toBe("429 rpc_upstream_busy");
    upstream(
      new Response("boom https://devnet.helius-rpc.com/?api-key=test-key-sentinel", {
        status: 500,
      }),
    );
    const failed = await POST(rpc(blockhashCall));
    const failedText = await failed.clone().text();
    expect(await errorOf(failed)).toBe("502 rpc_upstream_error");
    expect(failedText).not.toContain("sentinel");
    upstream(new TypeError("fetch failed"));
    expect(await errorOf(await POST(rpc(blockhashCall)))).toBe("502 rpc_upstream_error");
    upstream(new DOMException("The operation timed out.", "TimeoutError"));
    expect(await errorOf(await POST(rpc(blockhashCall)))).toBe("504 rpc_upstream_timeout");
  });

  it("answers 500 server_misconfigured when RPC_URL is missing, naming it only in the log", async () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("RPC_URL", "");
    const fetchMock = upstream(new Response("{}"));
    const response = await POST(rpc(blockhashCall));
    expect(await errorOf(response)).toBe("500 server_misconfigured");
    expect(fetchMock).not.toHaveBeenCalled();
    const errors = err.mock.calls.map((call) => String(call[0])).join("\n");
    expect(errors).toContain("RPC_URL is not set");
    expect(out.mock.calls.length + err.mock.calls.length).toBeGreaterThan(0);
  });
});
