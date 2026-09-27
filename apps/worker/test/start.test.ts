// Hosted environments (Vercel, Fly) have no .env.local: configuration comes only from the platform's
// environment variables (14 section 2). This runs the real worker entry, src/index.ts, from a copy of
// src/ in a temporary directory without .env.local, the way a container image runs it.
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const WORKER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SENTINEL = "sentinel-5c2e91";

describe("worker start without .env.local (hosted)", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "sotto-worker-start-"));
    cpSync(join(WORKER_DIR, "src"), join(dir, "src"), { recursive: true });
    copyFileSync(join(WORKER_DIR, "package.json"), join(dir, "package.json"));
    symlinkSync(join(WORKER_DIR, "node_modules"), join(dir, "node_modules"), "dir");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function start(env: Record<string, string>) {
    return spawnSync(process.execPath, [join(dir, "src", "index.ts")], {
      env: { PATH: process.env.PATH ?? "", ...env },
      encoding: "utf8",
      timeout: 30_000,
    });
  }

  it("starts with the variables set in the environment", () => {
    expect(existsSync(join(dir, ".env.local"))).toBe(false);
    const result = start({
      RPC_URL: `https://rpc.example.com/?api-key=${SENTINEL}`,
      SAS_CREDENTIAL_ADDRESS: "4KX4P7he62x5x8X35vubNNhJRhV4vJXPGNsc8skPyKFT",
      SAS_SCHEMA_ADDRESS: "A4PX8yuPQYeZFqtPomd5E3Jce7dTuWktcnpzb9YCM4z3",
    });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("sotto worker: started");
    expect(result.stdout).not.toContain(SENTINEL);
  });

  it("refuses to start without RPC_URL and names only the variable", () => {
    const result = start({});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sotto worker: configuration error: RPC_URL is not set");
  });

  it("refuses an invalid address and never prints the value", () => {
    const result = start({
      RPC_URL: "https://rpc.example.com",
      SAS_SCHEMA_ADDRESS: `not-an-address-${SENTINEL}`,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SAS_SCHEMA_ADDRESS is not a valid address");
    expect(result.stderr).not.toContain(SENTINEL);
  });
});
