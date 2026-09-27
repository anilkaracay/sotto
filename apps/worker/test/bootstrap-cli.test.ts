import { describe, expect, it } from "vitest";
import { parseCli } from "../src/bootstrap-cli.ts";

const OWNER = "6xosZg2PbZuneXX4riov7GmUCJmydQc3o5MGX6p5EU2";

describe("bootstrap:sas command line", () => {
  it("accepts devnet and localnet, with or without a test owner and a leading --", () => {
    expect(parseCli(["--cluster", "devnet"])).toEqual({
      cluster: "devnet",
      testOwner: null,
      signer: null,
    });
    expect(parseCli(["--", "--cluster", "localnet", "--test-attestation", OWNER])).toEqual({
      cluster: "localnet",
      testOwner: OWNER,
      signer: null,
    });
  });

  it("takes a signer keypair file on localnet only", () => {
    expect(parseCli(["--cluster", "localnet", "--signer", "/tmp/sas.json"])).toMatchObject({
      signer: "/tmp/sas.json",
    });
    expect(() => parseCli(["--cluster", "devnet", "--signer", "/tmp/sas.json"])).toThrow(
      "--signer is for localnet only",
    );
  });

  it("refuses mainnet, a missing cluster and a bad owner", () => {
    expect(() => parseCli(["--cluster", "mainnet"])).toThrow("mainnet is refused");
    expect(() => parseCli([])).toThrow("--cluster devnet or --cluster localnet is required");
    expect(() => parseCli(["--cluster", "devnet", "--test-attestation", "nope"])).toThrow(
      "--test-attestation needs a wallet address",
    );
    expect(() => parseCli(["--cluster", "devnet", "extra"])).toThrow();
  });
});
