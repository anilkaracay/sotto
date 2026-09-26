import { clusters } from "@sotto/sdk";
import { SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS } from "sas-lib";
import { describe, expect, it } from "vitest";

describe("SAS program ID", () => {
  it("in the sdk cluster config equals the sas-lib constant (D-24, facts E3)", () => {
    const devnet = clusters.devnet;
    if (!devnet.available) throw new Error("devnet must be available");
    expect(devnet.programs.sas).toBe(String(SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS));
  });
});
