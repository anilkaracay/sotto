// Pure helpers for the wallet lab's wallet list (unit tested in test/wallet-list.test.ts).
// Wallets may register more than once under the same name (Backpack registers two, one without
// standard:connect), so a name is never a key, and hooks are only used for connectable wallets.

export type WalletLike = {
  readonly name: string;
  readonly icon: string;
  readonly version: string;
  readonly chains: readonly string[];
  readonly features: readonly string[];
};

export const CONNECT_FEATURE = "standard:connect";
export const DISCONNECT_FEATURE = "standard:disconnect";

/** Connectable: supports standard:connect and declares at least one solana: chain. */
export function isConnectable(wallet: WalletLike): boolean {
  return (
    wallet.features.includes(CONNECT_FEATURE) &&
    wallet.chains.some((chain) => chain.startsWith("solana:"))
  );
}

/** standard:disconnect is optional in the Wallet Standard; useDisconnect throws without it. */
export function supportsDisconnect(wallet: Pick<WalletLike, "features">): boolean {
  return wallet.features.includes(DISCONNECT_FEATURE);
}

/** FNV-1a 32 bit hash, hex. Keeps keys short while icons are long data URIs. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Unique and stable for the session: index in the registry list, name and icon. */
export function walletKey(wallet: WalletLike, index: number): string {
  return `${index}:${wallet.name}:${fnv1a(wallet.icon)}`;
}

export type ListedWallet<T extends WalletLike> = { wallet: T; key: string; label: string };

/**
 * Splits the registry list into connectable wallets and the rest. Connectable wallets that share a
 * name are labeled "Name (1)", "Name (2)" in registry order.
 */
export function partitionWallets<T extends WalletLike>(
  wallets: readonly T[],
): { connectable: ListedWallet<T>[]; other: ListedWallet<T>[] } {
  const listed = wallets.map((wallet, index) => ({
    wallet,
    key: walletKey(wallet, index),
    label: wallet.name,
  }));
  const connectable = listed.filter((entry) => isConnectable(entry.wallet));
  const other = listed.filter((entry) => !isConnectable(entry.wallet));
  const counts = new Map<string, number>();
  for (const entry of connectable) {
    counts.set(entry.wallet.name, (counts.get(entry.wallet.name) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const labeled = connectable.map((entry) => {
    if ((counts.get(entry.wallet.name) ?? 0) < 2) return entry;
    const n = (seen.get(entry.wallet.name) ?? 0) + 1;
    seen.set(entry.wallet.name, n);
    return { ...entry, label: `${entry.wallet.name} (${n})` };
  });
  return { connectable: labeled, other };
}

export type FeatureInfo = {
  name: string;
  version: string | null;
  supportedTransactionVersions: readonly unknown[] | null;
  error?: string;
};

/** Feature names with versions; a getter that throws is recorded, never rethrown. */
export function summarizeFeatures(
  features: readonly string[],
  getFeature: (name: string) => unknown,
): FeatureInfo[] {
  return features.map((name) => {
    try {
      const feature = getFeature(name) as
        { version?: unknown; supportedTransactionVersions?: unknown } | null | undefined;
      return {
        name,
        version: typeof feature?.version === "string" ? feature.version : null,
        supportedTransactionVersions: Array.isArray(feature?.supportedTransactionVersions)
          ? feature.supportedTransactionVersions
          : null,
      };
    } catch (error) {
      return {
        name,
        version: null,
        supportedTransactionVersions: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
