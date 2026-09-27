import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConfigError, loadWorkerConfig, parseRpcUrl, readSasConfig } from "../src/config.ts";
import { LOCAL_ENV_FILE, loadLocalEnv } from "../src/env.ts";

const HELIUS = "https://devnet.helius-rpc.com/?api-key=test-key-123";
const CREDENTIAL = "7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L";
const SCHEMA = "6xosZg2PbZuneXX4riov7GmUCJmydQc3o5MGX6p5EU2";

function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a throw");
}

describe("loadLocalEnv (ENGINEERING-RULES.md: configuration comes from files)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sotto-worker-env-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads apps/worker/.env.local by default", () => {
    expect(LOCAL_ENV_FILE.endsWith(join("apps", "worker", ".env.local"))).toBe(true);
  });

  it("applies the file over the process environment and returns only names", () => {
    const file = join(dir, ".env.local");
    writeFileSync(
      file,
      `RPC_URL=${HELIUS}\n# a comment\nSAS_SCHEMA_ADDRESS=\nQUOTED="two words"\n`,
    );
    const env: NodeJS.ProcessEnv = { RPC_URL: "https://stale.example.com", KEEP: "kept" };
    expect(loadLocalEnv(file, env).sort()).toEqual(["QUOTED", "RPC_URL", "SAS_SCHEMA_ADDRESS"]);
    expect(env).toEqual({
      RPC_URL: HELIUS,
      KEEP: "kept",
      SAS_SCHEMA_ADDRESS: "",
      QUOTED: "two words",
    });
  });

  it("changes nothing when the file does not exist (deployed worker)", () => {
    const env: NodeJS.ProcessEnv = { RPC_URL: HELIUS };
    expect(loadLocalEnv(join(dir, "missing.env"), env)).toEqual([]);
    expect(env).toEqual({ RPC_URL: HELIUS });
  });
});

describe("worker config", () => {
  const FULL = {
    RPC_URL: ` ${HELIUS} `,
    DATABASE_URL: "postgresql://sotto:hidden-pw-9@127.0.0.1:56432/sotto",
    SAS_SIGNER_KEYPAIR: "~/.config/solana/sotto/sas-signer-devnet.json",
    SAS_CREDENTIAL_ADDRESS: CREDENTIAL,
    SAS_SCHEMA_ADDRESS: SCHEMA,
  };

  it("reads RPC_URL, DATABASE_URL and the SAS variables", () => {
    expect(loadWorkerConfig(FULL)).toEqual({
      rpcUrl: HELIUS,
      databaseUrl: "postgresql://sotto:hidden-pw-9@127.0.0.1:56432/sotto",
      sasSignerKeypair: "~/.config/solana/sotto/sas-signer-devnet.json",
      sasCredentialAddress: CREDENTIAL,
      sasSchemaAddress: SCHEMA,
    });
  });

  it("requires every variable the running worker needs, naming only the variable", () => {
    for (const name of [
      "DATABASE_URL",
      "SAS_SIGNER_KEYPAIR",
      "SAS_CREDENTIAL_ADDRESS",
      "SAS_SCHEMA_ADDRESS",
    ]) {
      const error = thrown(() => loadWorkerConfig({ ...FULL, [name]: "" }));
      expect(error.message).toBe(`${name} is not set`);
    }
    const bad = thrown(() =>
      loadWorkerConfig({ ...FULL, DATABASE_URL: "mysql://u:hidden-pw-9@h/d" }),
    );
    expect(bad.message).toBe("DATABASE_URL must be a postgres URL");
    expect(bad.message).not.toContain("hidden-pw-9");
  });

  it("treats empty SAS variables as unset", () => {
    expect(
      readSasConfig({
        SAS_SIGNER_KEYPAIR: "",
        SAS_CREDENTIAL_ADDRESS: " ",
        SAS_SCHEMA_ADDRESS: "",
      }),
    ).toEqual({ sasSignerKeypair: null, sasCredentialAddress: null, sasSchemaAddress: null });
  });

  it("rejects a missing, doubled, malformed or plain http RPC_URL without printing it", () => {
    expect(thrown(() => loadWorkerConfig({})).message).toBe("RPC_URL is not set");
    const cases: [string, string][] = [
      [`${HELIUS}${HELIUS}`, "RPC_URL must be a single URL"],
      [`${HELIUS} ${HELIUS}`, "RPC_URL must be a single URL"],
      ["devnet.helius-rpc.com/?api-key=test-key-123", "RPC_URL must be a single URL"],
      ["https://", "RPC_URL is not a valid URL"],
      [
        "http://devnet.helius-rpc.com/?api-key=test-key-123",
        "RPC_URL must use https (http only for a local validator)",
      ],
    ];
    for (const [value, message] of cases) {
      const error = thrown(() => parseRpcUrl(value));
      expect(error).toBeInstanceOf(ConfigError);
      expect(error.message).toBe(message);
      expect(error.message).not.toContain("test-key-123");
    }
  });

  it("allows plain http only for a local validator", () => {
    expect(parseRpcUrl("http://127.0.0.1:8899")).toBe("http://127.0.0.1:8899");
    expect(parseRpcUrl("http://localhost:8899")).toBe("http://localhost:8899");
  });

  it("rejects invalid addresses by name only", () => {
    const error = thrown(() => readSasConfig({ SAS_CREDENTIAL_ADDRESS: "not-an-address-xyz" }));
    expect(error.message).toBe("SAS_CREDENTIAL_ADDRESS is not a valid address");
    expect(error.message).not.toContain("xyz");
  });
});
