import { randomBytes } from "node:crypto";
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

  it("replaces the bearer token of an invite link path, plain or URL encoded", () => {
    // An invite link token has the shape of 32 random bytes in base64url (43 characters).
    const token = randomBytes(32).toString("base64url");
    const lines = [
      redact(`POST /api/invites/${token}/accept failed`),
      redact(`open https://sotto.example/app/invite/${token}?x=1`),
      redact(`next=%2Fapp%2Finvite%2F${token}&y=2`),
    ];
    expect(lines).toEqual([
      "POST /api/invites/:token/accept failed",
      "open https://sotto.example/app/invite/:token?x=1",
      "next=%2Fapp%2Finvite%2F:token&y=2",
    ]);
    for (const line of lines) expect(line).not.toContain(token);
  });
});
