import { describe, expect, it } from "vitest";
import { GENESIS_HASHES } from "@sotto/sdk/cluster";
import { assertDevnet } from "../src/sas/close.ts";
import { parseCloseCli } from "../src/sas-close-cli.ts";

const OWNER = "6xosZg2PbZuneXX4riov7GmUCJmydQc3o5MGX6p5EU2";

describe("attestation close (devnet only)", () => {
  it("accepts devnet and refuses mainnet and every other cluster", () => {
    expect(() => assertDevnet(GENESIS_HASHES.devnet)).not.toThrow();
    expect(() => assertDevnet(GENESIS_HASHES.mainnet)).toThrow("serves mainnet; refused");
    expect(() => assertDevnet("HPtqZ1HqNT86PKi6FoEDJCTMRWWiuGrLw9onsMhY5Gg1")).toThrow(
      "does not serve devnet",
    );
  });

  it("needs exactly one owner wallet", () => {
    expect(parseCloseCli(["--owner", OWNER])).toEqual({ owner: OWNER });
    expect(parseCloseCli(["--", "--owner", OWNER])).toEqual({ owner: OWNER });
    expect(() => parseCloseCli([])).toThrow("--owner <wallet> is required");
    expect(() => parseCloseCli(["--owner", "nope"])).toThrow("--owner needs a wallet address");
    expect(() => parseCloseCli(["--owner", OWNER, "--yes"])).toThrow();
  });
});
