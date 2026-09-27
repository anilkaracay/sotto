// API foundation units without a database: error format, redaction list, body reading and validation,
// Origin check (CSRF), server configuration.
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { readJson } from "../lib/server/body.ts";
import {
  appOrigin,
  ConfigError,
  databaseUrl,
  rpcUrl,
  sessionSecret,
} from "../lib/server/config.ts";
import { ApiError, apiErrors, errorResponse } from "../lib/server/errors.ts";
import { log, redact, scrub } from "../lib/server/log.ts";
import { assertSameOrigin } from "../lib/server/origin.ts";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

async function rejected(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("error format (08 section 3)", () => {
  it("is { error: { code, message } } with the status, the reason phrase and the request ID", async () => {
    const response = errorResponse(apiErrors.rateLimited(7), "req-1");
    expect(response.status).toBe(429);
    expect(response.statusText).toBe("Too many requests, retry later");
    expect(response.headers.get("retry-after")).toBe("7");
    expect(response.headers.get("x-request-id")).toBe("req-1");
    expect(await response.json()).toEqual({
      error: { code: "rate_limited", message: "Too many requests, retry later" },
    });
  });
});

describe("redaction list (08 section 6)", () => {
  it("replaces fields named like keys, signatures, ciphertexts, blobs, sessions and amounts", () => {
    expect(
      redact({
        requestId: "r",
        userId: "u",
        privateKey: "k",
        viewingSecretKey: "k",
        signature: "s",
        ciphertext: "c",
        privateBlob: "b",
        sessionId: "s",
        cookie: "c",
        authorization: "a",
        amount: 5,
        salaryCents: 5,
        nested: { balance: 9, status: "ok", items: [{ ikm: "x", ok: true }] },
        bytes: new Uint8Array([1, 2]),
      }),
    ).toEqual({
      requestId: "r",
      userId: "u",
      privateKey: "[redacted]",
      viewingSecretKey: "[redacted]",
      signature: "[redacted]",
      ciphertext: "[redacted]",
      privateBlob: "[redacted]",
      sessionId: "[redacted]",
      cookie: "[redacted]",
      authorization: "[redacted]",
      amount: "[redacted]",
      salaryCents: "[redacted]",
      nested: { balance: "[redacted]", status: "ok", items: [{ ikm: "[redacted]", ok: true }] },
      bytes: "[redacted]",
    });
  });

  it("removes connection strings, API keys and configured secret values from strings", () => {
    vi.stubEnv("SESSION_SECRET", "configured-secret-value-123456789");
    expect(scrub("connect postgresql://sotto:pw@127.0.0.1:56432/sotto failed")).toBe(
      "connect <database-url> failed",
    );
    expect(scrub("fetch https://devnet.helius-rpc.com/?api-key=abc123 failed")).toBe(
      "fetch <rpc-url> failed",
    );
    expect(scrub("https://rpc.example.com/?api-key=abc123&x=1")).toBe(
      "https://rpc.example.com/?api-key=[redacted]&x=1",
    );
    expect(scrub("key configured-secret-value-123456789 leaked")).toBe("key [redacted] leaked");
    expect(redact(new Error("postgres://u:p@h/d down"))).toEqual({
      name: "Error",
      message: "<database-url> down",
    });
  });

  it("keeps the statement of a failed query but never its parameters or the row detail", () => {
    const cause = Object.assign(new Error("duplicate key value violates unique constraint"), {
      code: "23505",
      constraint_name: "orgs_owner_user_id_key",
      detail: "Key (owner_user_id)=(1) already exists.",
    });
    const error = new Error(
      'Failed query: insert into "orgs" ("legal_name", "contact_email") values ($1, $2)\nparams: Northwind Labs Ltd,ops@northwind.example',
      { cause },
    );
    const out = redact(error);
    expect(out).toEqual({
      name: "Error",
      message: 'Failed query: insert into "orgs" ("legal_name", "contact_email") values ($1, $2)',
      cause: {
        name: "Error",
        message: "duplicate key value violates unique constraint",
        code: "23505",
        constraint: "orgs_owner_user_id_key",
      },
    });
    expect(JSON.stringify(out)).not.toMatch(/Northwind|ops@|already exists/);
  });

  it("writes one JSON line whose fixed keys cannot be overwritten", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    log("info", "api_request", { event: "spoofed", level: "spoofed", status: 200, token: "t" });
    const line = JSON.parse(out.mock.calls[0]?.[0] as string);
    expect(line).toMatchObject({
      event: "api_request",
      level: "info",
      status: 200,
      token: "[redacted]",
    });
    expect(typeof line.time).toBe("string");
  });
});

describe("request bodies", () => {
  const schema = z.object({ name: z.string(), count: z.number().int() }).strict();
  const request = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://localhost:3000/api/x", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body,
    });

  it("parses and validates JSON", async () => {
    const { data, text } = await readJson(request('{"name":"a","count":2}'), schema);
    expect(data).toEqual({ name: "a", count: 2 });
    expect(text).toBe('{"name":"a","count":2}');
  });

  it("refuses other content types with 415", async () => {
    expect(
      (await rejected(readJson(request("{}", { "content-type": "text/plain" }), schema))).status,
    ).toBe(415);
  });

  it("refuses bodies over the limit with 413, declared or streamed", async () => {
    expect((await rejected(readJson(request("x".repeat(100)), schema, 64))).status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(40)));
        controller.enqueue(new TextEncoder().encode("x".repeat(40)));
        controller.close();
      },
    });
    const streamed = new Request("http://localhost:3000/api/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit);
    expect((await rejected(readJson(streamed, schema, 64))).code).toBe("payload_too_large");
  });

  it("names the first invalid field without echoing values", async () => {
    const error = await rejected(readJson(request('{"name":"secret-value","count":"x"}'), schema));
    expect(error.status).toBe(400);
    expect(error.message).toBe(
      "Invalid request: count: Invalid input: expected number, received string",
    );
    expect(error.message).not.toContain("secret-value");
    expect((await rejected(readJson(request("{not json"), schema))).message).toBe(
      "Request body is not valid JSON",
    );
    const invalidUtf8 = new Request("http://localhost:3000/api/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new Uint8Array([0x7b, 0xff, 0x7d]),
    });
    expect((await rejected(readJson(invalidUtf8, schema))).message).toBe(
      "Request body is not valid UTF-8",
    );
  });
});

describe("Origin check (CSRF, 08 section 6)", () => {
  const post = (origin?: string) =>
    new Request("http://localhost:3000/api/x", {
      method: "POST",
      headers: origin ? { origin } : {},
    });

  it("lets safe methods through", () => {
    expect(() => assertSameOrigin(new Request("http://localhost:3000/api/x"))).not.toThrow();
  });

  it("accepts the request's own origin and NEXT_PUBLIC_APP_URL", () => {
    expect(() => assertSameOrigin(post("http://localhost:3000"))).not.toThrow();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.sotto.example/some/path");
    expect(() => assertSameOrigin(post("https://app.sotto.example"))).not.toThrow();
  });

  it("refuses a missing or foreign Origin with 403", () => {
    expect((thrown(() => assertSameOrigin(post())) as ApiError).code).toBe("forbidden_origin");
    expect((thrown(() => assertSameOrigin(post("https://evil.example"))) as ApiError).status).toBe(
      403,
    );
    expect((thrown(() => assertSameOrigin(post("http://localhost:3001"))) as ApiError).status).toBe(
      403,
    );
  });
});

describe("server configuration (14 section 2)", () => {
  it("validates each variable and names it without its value", () => {
    const cases: [() => unknown, string][] = [
      [() => databaseUrl({}), "DATABASE_URL is not set"],
      [
        () => databaseUrl({ DATABASE_URL: "mysql://u:hidden-1@h/d" }),
        "DATABASE_URL must be a postgres URL",
      ],
      [
        () => rpcUrl({ RPC_URL: "http://rpc.example/?api-key=hidden-2" }),
        "RPC_URL must use https (http only for a local validator)",
      ],
      [
        () => rpcUrl({ RPC_URL: "https://a/?k=hidden-3https://a/?k=hidden-3" }),
        "RPC_URL must be a single URL",
      ],
      [
        () => sessionSecret({ SESSION_SECRET: "short-hidden-4" }),
        "SESSION_SECRET must be at least 32 characters",
      ],
      [
        () => appOrigin({ NEXT_PUBLIC_APP_URL: "not a url" }),
        "NEXT_PUBLIC_APP_URL must be a single URL",
      ],
    ];
    for (const [run, message] of cases) {
      const error = thrown(run) as ConfigError;
      expect(error).toBeInstanceOf(ConfigError);
      expect(error.message).toBe(message);
      expect(error.message).not.toMatch(/hidden/);
    }
    expect(rpcUrl({ RPC_URL: "http://127.0.0.1:8899" })).toBe("http://127.0.0.1:8899");
    expect(appOrigin({}, undefined)).toBeNull();
    expect(appOrigin({}, "https://preview-abc.vercel.app")).toBe("https://preview-abc.vercel.app");
    expect(
      appOrigin({ NEXT_PUBLIC_APP_URL: "http://localhost:3200" }, "http://localhost:3000"),
    ).toBe("http://localhost:3200");
  });
});
