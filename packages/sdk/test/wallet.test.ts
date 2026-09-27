import { describe, expect, it } from "vitest";
import {
  canBeOffered,
  canHoldConfidentialBalances,
  signInMethod,
  transactionPath,
  walletCapabilities,
  type WalletLike,
} from "../src/wallet/index.ts";

const full: WalletLike = {
  chains: ["solana:devnet", "solana:mainnet", "sui:mainnet"],
  features: {
    "standard:connect": {},
    "standard:disconnect": {},
    "solana:signTransaction": { supportedTransactionVersions: ["legacy", 0, 1] },
    "solana:signMessage": {},
    "solana:signIn": {},
  },
};

describe("wallet capabilities (D-26, D-15)", () => {
  it("reads declared features from a Wallet Standard wallet", () => {
    expect(walletCapabilities(full)).toEqual({
      connect: true,
      disconnect: true,
      signTransaction: true,
      supportedTransactionVersions: ["legacy", 0, 1],
      signMessage: true,
      signIn: true,
      solanaChains: ["solana:devnet", "solana:mainnet"],
    });
  });

  it("reads feature names from a UiWallet (features as a list)", () => {
    const ui: WalletLike = {
      chains: ["solana:devnet"],
      features: ["standard:connect", "solana:signTransaction"],
    };
    const capabilities = walletCapabilities(ui);
    expect(capabilities).toMatchObject({
      connect: true,
      signTransaction: true,
      signIn: false,
      signMessage: false,
    });
    expect(capabilities.supportedTransactionVersions).toEqual([]);
  });

  it("offers a wallet only with connect, signTransaction and a solana chain", () => {
    expect(canBeOffered(walletCapabilities(full))).toBe(true);
    const noTx: WalletLike = { chains: ["solana:devnet"], features: { "standard:connect": {} } };
    const noChain: WalletLike = { chains: ["ethereum:1"], features: full.features };
    expect(canBeOffered(walletCapabilities(noTx))).toBe(false);
    expect(canBeOffered(walletCapabilities(noChain))).toBe(false);
  });

  it("signs in with solana:signIn first, then solana:signMessage, else not at all", () => {
    expect(signInMethod(walletCapabilities(full))).toBe("signIn");
    const messageOnly: WalletLike = {
      chains: ["solana:devnet"],
      features: { "standard:connect": {}, "solana:signTransaction": {}, "solana:signMessage": {} },
    };
    expect(signInMethod(walletCapabilities(messageOnly))).toBe("signMessage");
    const neither: WalletLike = {
      chains: ["solana:devnet"],
      features: { "standard:connect": {}, "solana:signTransaction": {} },
    };
    expect(signInMethod(walletCapabilities(neither))).toBeNull();
    expect(canHoldConfidentialBalances(walletCapabilities(neither))).toBe(false);
    expect(canHoldConfidentialBalances(walletCapabilities(messageOnly))).toBe(true);
  });

  it("chooses v1 plans only when the wallet declares version 1", () => {
    expect(transactionPath(walletCapabilities(full))).toBe("v1");
    const v0: WalletLike = {
      chains: ["solana:devnet"],
      features: {
        "standard:connect": {},
        "solana:signTransaction": { supportedTransactionVersions: ["legacy", 0] },
      },
    };
    expect(transactionPath(walletCapabilities(v0))).toBe("v0");
  });
});
