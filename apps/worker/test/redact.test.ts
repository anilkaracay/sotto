import { describe, expect, it } from "vitest";
import { redact } from "../src/redact.ts";

describe("redact", () => {
  it("removes Helius URLs, API keys and given secrets", () => {
    const url = "https://devnet.helius-rpc.com/?api-key=abc-123";
    // Everything up to the next space goes, so a trailing colon never keeps part of a key.
    expect(redact(`fetch failed for ${url}: ECONNRESET`)).toBe(
      "fetch failed for <rpc-url> ECONNRESET",
    );
    expect(redact("key api-key=abc-123&x=1")).toBe("key api-key=<redacted>&x=1");
    expect(redact("rpc http://10.0.0.5:8899/secret failed", ["http://10.0.0.5:8899/secret"])).toBe(
      "rpc <redacted> failed",
    );
  });
});
