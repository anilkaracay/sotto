// The Solana Explorer links (step 4.6).
import { describe, expect, it } from "vitest";
import { explorerUrl } from "../lib/explorer.ts";

describe("explorer links", () => {
  it("names the cluster for devnet, nothing for mainnet, and gives no link on a local ledger", () => {
    expect(explorerUrl("tx", "5sig", "devnet")).toBe(
      "https://explorer.solana.com/tx/5sig?cluster=devnet",
    );
    expect(explorerUrl("address", "A7pe", "devnet")).toBe(
      "https://explorer.solana.com/address/A7pe?cluster=devnet",
    );
    expect(explorerUrl("address", "A7pe", "mainnet")).toBe(
      "https://explorer.solana.com/address/A7pe",
    );
    expect(explorerUrl("tx", "5sig", "localnet")).toBeNull();
  });

  it("keeps a value from changing the link's path or query", () => {
    expect(explorerUrl("tx", "a/b?cluster=mainnet", "devnet")).toBe(
      "https://explorer.solana.com/tx/a%2Fb%3Fcluster%3Dmainnet?cluster=devnet",
    );
  });
});
