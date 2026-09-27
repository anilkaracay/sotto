import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/main.ts";

describe("@sotto/worker main", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stops with the name of a missing variable", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main(["--once"], {})).toBe(1);
    expect(error).toHaveBeenCalledWith("sotto worker: configuration error: RPC_URL is not set");
  });

  it("stops when the SAS signer keypair cannot be read, naming the file only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await main(["--once"], {
      RPC_URL: "http://127.0.0.1:8899",
      DATABASE_URL: "postgresql://postgres@127.0.0.1:56433/postgres",
      SAS_SIGNER_KEYPAIR: "/nonexistent/sas-signer.json",
      SAS_CREDENTIAL_ADDRESS: "4KX4P7he62x5x8X35vubNNhJRhV4vJXPGNsc8skPyKFT",
      SAS_SCHEMA_ADDRESS: "A4PX8yuPQYeZFqtPomd5E3Jce7dTuWktcnpzb9YCM4z3",
    });
    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith(
      "sotto worker: configuration error: cannot read the keypair file /nonexistent/sas-signer.json (ENOENT)",
    );
  });
});
