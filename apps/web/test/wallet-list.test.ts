import { describe, expect, it } from "vitest";
import {
  isConnectable,
  partitionWallets,
  summarizeFeatures,
  supportsDisconnect,
  walletKey,
  type WalletLike,
} from "../app/dev/wallet-lab/wallet-list";

function wallet(overrides: Partial<WalletLike>): WalletLike {
  return {
    name: "Wallet",
    icon: "data:image/svg+xml;base64,AAAA",
    version: "1.0.0",
    chains: ["solana:devnet"],
    features: ["standard:connect", "solana:signMessage"],
    ...overrides,
  };
}

describe("isConnectable", () => {
  it("requires standard:connect and a solana: chain", () => {
    expect(isConnectable(wallet({}))).toBe(true);
    expect(isConnectable(wallet({ features: ["solana:signMessage"] }))).toBe(false);
    expect(isConnectable(wallet({ chains: ["ethereum:1"] }))).toBe(false);
    expect(isConnectable(wallet({ chains: [], features: [] }))).toBe(false);
  });
});

describe("supportsDisconnect", () => {
  it("is true only when standard:disconnect is declared", () => {
    expect(supportsDisconnect(wallet({}))).toBe(false);
    expect(
      supportsDisconnect(wallet({ features: ["standard:connect", "standard:disconnect"] })),
    ).toBe(true);
  });
});

describe("walletKey", () => {
  it("differs for wallets that share a name", () => {
    const a = wallet({ name: "Backpack", icon: "data:image/png;base64,ONE" });
    const b = wallet({ name: "Backpack", icon: "data:image/png;base64,TWO" });
    expect(walletKey(a, 0)).not.toBe(walletKey(b, 1));
    expect(walletKey(a, 0)).not.toBe(walletKey(a, 1));
  });

  it("is stable for the same wallet and index", () => {
    const a = wallet({ name: "Backpack" });
    expect(walletKey(a, 2)).toBe(walletKey({ ...a }, 2));
  });
});

describe("partitionWallets", () => {
  it("keeps a same-name wallet without standard:connect out of the connectable list", () => {
    const connectable = wallet({ name: "Backpack", icon: "data:image/png;base64,ONE" });
    const readOnly = wallet({
      name: "Backpack",
      icon: "data:image/png;base64,TWO",
      features: ["solana:signMessage"],
    });
    const result = partitionWallets([connectable, readOnly, wallet({ name: "Phantom" })]);
    expect(result.connectable.map((w) => w.label)).toEqual(["Backpack", "Phantom"]);
    expect(result.other.map((w) => w.wallet)).toEqual([readOnly]);
    const keys = [...result.connectable, ...result.other].map((w) => w.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("labels connectable wallets that share a name (1) and (2)", () => {
    const result = partitionWallets([
      wallet({ name: "Backpack", icon: "data:image/png;base64,ONE" }),
      wallet({ name: "Solflare" }),
      wallet({ name: "Backpack", icon: "data:image/png;base64,TWO" }),
    ]);
    expect(result.connectable.map((w) => w.label)).toEqual([
      "Backpack (1)",
      "Solflare",
      "Backpack (2)",
    ]);
    expect(result.connectable[0]?.key).not.toBe(result.connectable[2]?.key);
  });
});

describe("summarizeFeatures", () => {
  it("records versions and never rethrows", () => {
    const features = summarizeFeatures(
      ["standard:connect", "solana:signTransaction", "x:broken"],
      (name) => {
        if (name === "x:broken") throw new Error("no feature object");
        if (name === "solana:signTransaction") {
          return { version: "1.0.0", supportedTransactionVersions: ["legacy", 0] };
        }
        return { version: "1.0.0" };
      },
    );
    expect(features).toEqual([
      { name: "standard:connect", version: "1.0.0", supportedTransactionVersions: null },
      {
        name: "solana:signTransaction",
        version: "1.0.0",
        supportedTransactionVersions: ["legacy", 0],
      },
      {
        name: "x:broken",
        version: null,
        supportedTransactionVersions: null,
        error: "no feature object",
      },
    ]);
  });
});
