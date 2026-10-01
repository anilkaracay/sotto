// The sign in screen's wallet groups (D-26; step 3.4.1): by declared capability, never by name.
import type { WalletCapabilities } from "@sotto/sdk/wallet";
import { describe, expect, it } from "vitest";
import { missingWords, walletGroup } from "../lib/wallet-groups.ts";

const full: WalletCapabilities = {
  connect: true,
  disconnect: true,
  signTransaction: true,
  supportedTransactionVersions: ["legacy", 0, 1],
  signMessage: true,
  signIn: true,
  solanaChains: ["solana:devnet"],
};

describe("wallet groups (D-26)", () => {
  it("puts a wallet that signs messages in the confidential group", () => {
    expect(walletGroup(full)).toBe("confidential");
    expect(walletGroup({ ...full, signIn: false })).toBe("confidential");
  });

  it("lets a wallet that signs in but signs no messages sign in only", () => {
    expect(walletGroup({ ...full, signMessage: false })).toBe("sign_in_only");
  });

  it("does not offer a wallet without connect, transactions, a Solana chain or a way to sign in", () => {
    for (const lacking of [
      { connect: false },
      { signTransaction: false, supportedTransactionVersions: [] },
      { solanaChains: [] },
      { signIn: false, signMessage: false },
    ]) {
      expect(walletGroup({ ...full, ...lacking })).toBe("unsupported");
    }
    expect(missingWords({ ...full, signTransaction: false })).toBe(
      "It does not support signing transactions.",
    );
    expect(missingWords({ ...full, connect: false, solanaChains: [] })).toBe(
      "It does not support connecting or a Solana network.",
    );
  });
});
