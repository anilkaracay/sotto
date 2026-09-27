import {
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
  SolanaError,
  type RpcTransport,
} from "@solana/kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_RPC_RETRIES, retryingTransport } from "../app/dev/wallet-lab/lab-core";
import {
  checkLabRpcRequest,
  LAB_RPC_METHODS,
  RPC_URL_ERROR,
  validateRpcUrl,
} from "../app/dev/wallet-lab/rpc-proxy";
import { POST } from "../app/dev/wallet-lab/rpc/route.dev";

// Fake, low entropy value: never a real key.
const VALID_URL = "https://devnet.helius-rpc.com/?api-key=test";

function rpcRequest(body: unknown): Request {
  return new Request("http://localhost:3000/dev/wallet-lab/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function notFoundDigest(run: () => Promise<unknown>): Promise<string | undefined> {
  return run().then(
    () => undefined,
    (error: unknown) => (error as { digest?: string }).digest,
  );
}

describe("validateRpcUrl", () => {
  it("accepts an https helius-rpc.com URL that contains the host once", () => {
    expect(validateRpcUrl(VALID_URL)).toEqual({ ok: true, url: VALID_URL });
  });

  it("rejects missing, doubled, non Helius and non https values without echoing them", () => {
    for (const value of [
      undefined,
      "",
      "https://api.devnet.solana.com",
      "https://devnet.helius-rpc.com/?api-key=https://devnet.helius-rpc.com/?api-key=test",
      "http://devnet.helius-rpc.com/?api-key=test",
      "https://helius-rpc.com.example.org/?api-key=test",
      "not a url helius-rpc.com",
    ]) {
      const result = validateRpcUrl(value);
      expect(result).toEqual({ ok: false, error: RPC_URL_ERROR });
    }
  });
});

describe("checkLabRpcRequest", () => {
  it("allows exactly the lab methods", () => {
    expect([...LAB_RPC_METHODS]).toEqual([
      "getLatestBlockhash",
      "sendTransaction",
      "getSignatureStatuses",
      "getBalance",
      "getTransaction",
    ]);
    for (const method of LAB_RPC_METHODS) {
      expect(checkLabRpcRequest({ jsonrpc: "2.0", id: 1, method })).toEqual({ ok: true, method });
    }
  });

  it("refuses other methods, batches and malformed requests", () => {
    expect(checkLabRpcRequest({ jsonrpc: "2.0", id: 1, method: "requestAirdrop" })).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(checkLabRpcRequest({ jsonrpc: "2.0", id: 1, method: "getAccountInfo" })).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(checkLabRpcRequest([{ jsonrpc: "2.0", id: 1, method: "getBalance" }])).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(checkLabRpcRequest({ id: 1, method: "getBalance" })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(checkLabRpcRequest(null)).toMatchObject({ ok: false, status: 400 });
  });
});

describe("POST /dev/wallet-lab/rpc", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is a 404 outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RPC_URL", VALID_URL);
    expect(
      await notFoundDigest(() => POST(rpcRequest({ jsonrpc: "2.0", id: 1, method: "getBalance" }))),
    ).toMatch(/404/);
  });

  it("reports a missing or invalid RPC_URL", async () => {
    vi.stubEnv("NODE_ENV", "development");
    for (const value of [
      "",
      "https://devnet.helius-rpc.com/?api-key=https://devnet.helius-rpc.com/?api-key=test",
    ]) {
      vi.stubEnv("RPC_URL", value);
      const response = await POST(rpcRequest({ jsonrpc: "2.0", id: 1, method: "getBalance" }));
      expect(response.status).toBe(500);
      expect(response.statusText).toBe(RPC_URL_ERROR);
      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toBe(RPC_URL_ERROR);
    }
  });

  it("no longer reads HELIUS_DEVNET_URL (step 1.1)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("HELIUS_DEVNET_URL", VALID_URL);
    vi.stubEnv("RPC_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(rpcRequest({ jsonrpc: "2.0", id: 1, method: "getBalance" }));
    expect(response.status).toBe(500);
    expect(response.statusText).toBe(RPC_URL_ERROR);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a method outside the allow list without calling upstream", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RPC_URL", VALID_URL);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(rpcRequest({ jsonrpc: "2.0", id: 7, method: "requestAirdrop" }));
    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards allowed methods to RPC_URL and never returns the URL", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RPC_URL", VALID_URL);
    const fetchMock = vi.fn(async () =>
      Response.json({ jsonrpc: "2.0", id: 3, result: { value: { blockhash: "x" } } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const request = { jsonrpc: "2.0", id: 3, method: "getLatestBlockhash", params: [] };
    const response = await POST(rpcRequest(request));
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      VALID_URL,
      expect.objectContaining({ method: "POST", body: JSON.stringify(request) }),
    );
    const text = await response.text();
    expect(text).toContain('"blockhash":"x"');
    expect(text).not.toContain("helius-rpc.com");
  });

  it("passes an upstream 429 through and hides upstream failures", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RPC_URL", VALID_URL);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Too Many Requests", { status: 429 })),
    );
    expect((await POST(rpcRequest({ jsonrpc: "2.0", id: 1, method: "getBalance" }))).status).toBe(
      429,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(`connect ECONNREFUSED ${VALID_URL}`);
      }),
    );
    const failed = await POST(rpcRequest({ jsonrpc: "2.0", id: 1, method: "getBalance" }));
    expect(failed.status).toBe(502);
    expect(await failed.text()).not.toContain("helius-rpc.com");
  });
});

describe("retryingTransport", () => {
  const rateLimited = () =>
    new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
      headers: new Headers(),
      message: "Too Many Requests",
      statusCode: 429,
    });
  const config = {
    payload: { jsonrpc: "2.0", id: 1, method: "getBalance" },
    signal: undefined,
  } as unknown as Parameters<RpcTransport>[0];

  it("retries 429 with exponential backoff and reports each retry", async () => {
    let calls = 0;
    const inner = (async () => {
      calls++;
      if (calls < 3) throw rateLimited();
      return { ok: true };
    }) as unknown as RpcTransport;
    const notices: [number, number, number][] = [];
    const sleeps: number[] = [];
    const transport = retryingTransport(
      inner,
      (r, m, d) => notices.push([r, m, d]),
      async (ms) => {
        sleeps.push(ms);
      },
    );
    await expect(transport(config)).resolves.toEqual({ ok: true });
    expect(notices).toEqual([
      [1, 3, 1000],
      [2, 3, 2000],
    ]);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("gives up after the maximum number of retries and does not retry other errors", async () => {
    let calls = 0;
    const always429 = (async () => {
      calls++;
      throw rateLimited();
    }) as unknown as RpcTransport;
    await expect(retryingTransport(always429, undefined, async () => {})(config)).rejects.toThrow();
    expect(calls).toBe(MAX_RPC_RETRIES + 1);

    let otherCalls = 0;
    const otherError = (async () => {
      otherCalls++;
      throw new Error("boom");
    }) as unknown as RpcTransport;
    await expect(retryingTransport(otherError, undefined, async () => {})(config)).rejects.toThrow(
      "boom",
    );
    expect(otherCalls).toBe(1);
  });
});
