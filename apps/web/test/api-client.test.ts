// The browser's calls to the Sotto API (step 4.9): a call that gets no answer in time is given up with
// its own words, so no page waits on one request without end; and what the owner reads when a
// payment's transfer was sent and nothing confirmed it in time.
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_TIMEOUT_MS, ApiCallError, callApi } from "../lib/client/api.ts";
import {
  UNDECIDED_WAIT_MS,
  undecidedTransferMessage,
} from "../app/app/[org]/payments/new/payment-run.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("callApi (step 4.9)", () => {
  it("gives every call a time limit", async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    vi.stubGlobal("fetch", async (_: string, init: RequestInit) => {
      seen.push(init.signal);
      return Response.json({ ok: true });
    });
    await expect(callApi<{ ok: boolean }>("/api/health")).resolves.toEqual({ ok: true });
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(API_TIMEOUT_MS).toBe(30_000);
  });

  it("says that Sotto did not answer in time, apart from a network that cannot be reached", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    const late = await callApi("/api/health").then(
      () => null,
      (error: unknown) => error,
    );
    expect(late).toBeInstanceOf(ApiCallError);
    expect(late).toMatchObject({
      status: 0,
      code: "timeout",
      message: "Sotto did not answer in time. Try again.",
    });
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(callApi("/api/health")).rejects.toMatchObject({ code: "network_error" });
  });
});

describe("a transfer that was sent and not confirmed in time (step 4.9)", () => {
  it("tells the owner it was sent, where to see it settle, and not to pay again", () => {
    const words = undecidedTransferMessage(
      "KBCpLLAmGM6gryXJ3Yp7w5Qm5Zt1mJcN5xqfXh2nQkq6m3u8Yc1r2s3t4u5v6w7x8y9zABCDEFGHJKLMNPQRSTUV",
    );
    expect(words).toBe(
      "The transfer was sent (transaction KBCpLLAmGM6g…), but the network did not confirm it in time. Sotto keeps checking it: this payment shows Settled under Recent payments once it lands. Do not pay again before then.",
    );
    expect(UNDECIDED_WAIT_MS).toBe(120_000);
  });
});
