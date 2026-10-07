// Bearer tokens in URLs never reach a log (founder 2026-09-29; step 2.1): the invite link
// token of /app/invite/[token] and /api/invites/[token] becomes ":token" in every logged string,
// plain or URL encoded, and every dynamic route segment named like a secret must be covered.
import { randomBytes } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BEARER_PATH_PREFIXES, log, scrub } from "../lib/server/log.ts";

const APP_DIR = fileURLToPath(new URL("../app", import.meta.url));
/** Segment names that hold a secret whoever has the URL can use. */
const SECRET_SEGMENT = /token|secret|key|code|nonce|password/i;
const newToken = () => randomBytes(32).toString("base64url");

/** Every directory under app/ that is a dynamic route segment, as a URL path pattern. */
function dynamicRoutes(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (/^\[.+\]$/.test(entry)) found.push(full);
    dynamicRoutes(full, found);
  }
  return found;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bearer tokens in logged URLs", () => {
  it("replaces the invite link token in paths, full URLs and URL encoded values", () => {
    const token = newToken();
    const cases = [
      [`/api/invites/${token}`, "/api/invites/:token"],
      [`/api/invites/${token}/accept`, "/api/invites/:token/accept"],
      [
        `https://sotto.example/app/invite/${token}?from=mail`,
        "https://sotto.example/app/invite/:token?from=mail",
      ],
      [
        `/app/sign-in?next=%2Fapp%2Finvite%2F${token}`,
        "/app/sign-in?next=%2Fapp%2Finvite%2F:token",
      ],
      [`next=%2fapp%2finvite%2f${token}&x=1`, "next=%2fapp%2finvite%2f:token&x=1"],
    ] as const;
    for (const [input, output] of cases) expect(scrub(input)).toBe(output);
    // Other paths keep their segments.
    expect(scrub("/api/orgs/3f1b6a2e-5c4d-4e8f-9a0b-1c2d3e4f5a6b/payments")).toBe(
      "/api/orgs/3f1b6a2e-5c4d-4e8f-9a0b-1c2d3e4f5a6b/payments",
    );
  });

  it("covers every dynamic route segment named like a secret", () => {
    const secretRoutes = dynamicRoutes(APP_DIR).filter((dir) =>
      SECRET_SEGMENT.test(dir.split(sep).at(-1) ?? ""),
    );
    // The invite page and the invite API today; a new one fails here until it is listed.
    expect(secretRoutes.length).toBeGreaterThanOrEqual(2);
    for (const dir of secretRoutes) {
      const token = newToken();
      const segments = relative(APP_DIR, dir)
        .split(sep)
        .filter((segment) => !/^\(.+\)$/.test(segment));
      // The secret segment gets a token; any other dynamic segment a plain value.
      const path = `/${segments
        .map((segment) =>
          /^\[.+\]$/.test(segment) ? (SECRET_SEGMENT.test(segment) ? token : "x") : segment,
        )
        .join("/")}`;
      const logged = scrub(path);
      expect(
        logged,
        `${path} is not redacted; add its prefix to BEARER_PATH_PREFIXES`,
      ).not.toContain(token);
      expect(BEARER_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))).toBe(true);
    }
  });

  it("writes no invite link token in a log line, in any field", () => {
    const token = newToken();
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => lines.push(line));
    vi.spyOn(console, "error").mockImplementation((line: string) => lines.push(line));
    log("info", "api_request", { path: `/api/invites/${token}/accept`, method: "POST" });
    log("error", "api_unhandled_error", {
      error: new Error(`fetch /app/invite/${token} failed`),
      next: `%2Fapp%2Finvite%2F${token}`,
    });
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).not.toContain(token);
    expect(lines[0]).toContain('"path":"/api/invites/:token/accept"');
  });
});
