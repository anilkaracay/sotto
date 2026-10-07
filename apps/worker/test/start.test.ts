// Hosted environments (Vercel, Fly) have no .env.local: configuration comes only from the platform's
// environment variables. This runs the real worker entry, src/index.ts, from a copy of
// src/ in a temporary directory without .env.local, the way a container image runs it.
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDatabase, type TestDatabase } from "@sotto/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const WORKER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SENTINEL = "sentinel-5c2e91";

describe("worker start without .env.local (hosted)", () => {
  let dir: string;
  let database: TestDatabase;
  let keypairFile: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), "sotto-worker-start-"));
    cpSync(join(WORKER_DIR, "src"), join(dir, "src"), { recursive: true });
    copyFileSync(join(WORKER_DIR, "package.json"), join(dir, "package.json"));
    symlinkSync(join(WORKER_DIR, "node_modules"), join(dir, "node_modules"), "dir");
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const seed = Buffer.from(privateKey.export({ format: "jwk" }).d as string, "base64url");
    const pub = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url");
    keypairFile = join(dir, "signer.json");
    writeFileSync(keypairFile, JSON.stringify([...seed, ...pub]));
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.drop();
    rmSync(dir, { recursive: true, force: true });
  });

  function start(env: Record<string, string>) {
    return spawnSync(process.execPath, [join(dir, "src", "index.ts"), "--once"], {
      env: { PATH: process.env.PATH ?? "", ...env },
      encoding: "utf8",
      timeout: 60_000,
    });
  }

  function hostedEnv(): Record<string, string> {
    return {
      // No org or token account needs work, so the jobs make no RPC call; the URL is still validated.
      RPC_URL: `https://rpc.example.com/?api-key=${SENTINEL}`,
      DATABASE_URL: database.url,
      SAS_SIGNER_KEYPAIR: keypairFile,
      SAS_CREDENTIAL_ADDRESS: "4KX4P7he62x5x8X35vubNNhJRhV4vJXPGNsc8skPyKFT",
      SAS_SCHEMA_ADDRESS: "A4PX8yuPQYeZFqtPomd5E3Jce7dTuWktcnpzb9YCM4z3",
    };
  }

  it("starts with the variables set in the environment and runs each job once", () => {
    expect(existsSync(join(dir, ".env.local"))).toBe(false);
    const result = start(hostedEnv());
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"event":"worker_started"');
    expect(result.stdout).toContain('"job":"sas-issue"');
    expect(result.stdout).toContain('"job":"pending-credits"');
    expect(result.stdout).toContain('"job":"recipient-readiness"');
    expect(result.stdout).toContain('"job":"confirm-executions"');
    expect(result.stdout).toContain('"job":"payroll-runs"');
    expect(result.stdout).toContain('"job":"grant-expiry"');
    expect(result.stdout).toContain('"job":"index-accounts"');
    // An RPC that cannot be reached is no verdict on the proof program: logged, nothing stored.
    expect(result.stdout).toContain('"job":"proof-program-health"');
    expect(result.stdout).toContain('"event":"proof_program_check_unreachable"');
    expect(result.stdout).toContain('"event":"worker_stopped"');
    expect(result.stdout).not.toContain(SENTINEL);
  });

  it("refuses to start without RPC_URL and names only the variable", () => {
    const result = start({});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("sotto worker: configuration error: RPC_URL is not set");
  });

  it("refuses an invalid address and never prints the value", () => {
    const result = start({ ...hostedEnv(), SAS_SCHEMA_ADDRESS: `not-an-address-${SENTINEL}` });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("SAS_SCHEMA_ADDRESS is not a valid address");
    expect(result.stderr).not.toContain(SENTINEL);
  });
});
