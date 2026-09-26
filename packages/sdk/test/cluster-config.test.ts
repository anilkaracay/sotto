import { describe, expect, it } from "vitest";
import { clusters, DEVNET_TEST_WRAP_LABEL, getClusterConfig } from "../src/cluster/config.ts";

// Values verified by Gate G1 (docs/02-VERIFIED-FACTS.md H1, C8, E3, F1). If a package constant ever
// changes, this test fails before any code uses the new value.
const VERIFIED = {
  token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  zkElGamalProof: "ZkE1Gama1Proof11111111111111111111111111111",
  tokenWrapDevnetTest: "EEvqpjNRQkNRwXzVziuTGGi1wYDiPv7haYVVu3XZCoQn",
  sas: "22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG",
  devnetUsdc: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  devnetWrappedUsdc: "AhJfP4JJBaHWRtXRiaScZUC7SMm4RqUPSb3g9H5RT8Bd",
};

describe("cluster config", () => {
  it("holds the verified devnet values", () => {
    const devnet = getClusterConfig("devnet");
    if (!devnet.available) throw new Error("devnet must be available");
    expect(devnet.programs.token2022).toBe(VERIFIED.token2022);
    expect(devnet.programs.zkElGamalProof).toBe(VERIFIED.zkElGamalProof);
    expect(devnet.programs.tokenWrap).toBe(VERIFIED.tokenWrapDevnetTest);
    expect(devnet.programs.sas).toBe(VERIFIED.sas);
    expect(devnet.usdcMint).toBe(VERIFIED.devnetUsdc);
    expect(devnet.wrappedUsdcMint).toBe(VERIFIED.devnetWrappedUsdc);
    expect(devnet.tokenWrapLabel).toBe(DEVNET_TEST_WRAP_LABEL);
  });

  it("uses the same patched Token Wrap on localnet", () => {
    const localnet = getClusterConfig("localnet");
    if (!localnet.available) throw new Error("localnet must be available");
    expect(localnet.programs.tokenWrap).toBe(VERIFIED.tokenWrapDevnetTest);
    expect(localnet.programs.token2022).toBe(VERIFIED.token2022);
  });

  it("marks mainnet unavailable", () => {
    expect(clusters.mainnet.available).toBe(false);
  });

  it("never references the deprecated ZK Token Proof program (I-4)", () => {
    expect(JSON.stringify(clusters)).not.toContain("ZkTokenProof");
  });
});
