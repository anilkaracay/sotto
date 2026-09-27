// Wallet capabilities per role (D-26). Sotto is wallet agnostic: it reads each wallet's declared
// Wallet Standard features at runtime and never matches wallet names. Sign in (D-15) uses solana:signIn
// when the wallet has it, otherwise a signed message.

/** The part of a Wallet Standard wallet (or a UiWallet) these checks read. */
export type WalletLike = {
  readonly chains: readonly string[];
  readonly features: readonly string[] | Readonly<Record<string, unknown>>;
};

export type TransactionVersion = "legacy" | 0 | 1;

export type WalletCapabilities = {
  connect: boolean;
  disconnect: boolean;
  signTransaction: boolean;
  /** From the solana:signTransaction feature; empty when the wallet cannot sign transactions. */
  supportedTransactionVersions: readonly TransactionVersion[];
  signMessage: boolean;
  signIn: boolean;
  solanaChains: readonly string[];
};

export type SignInMethod = "signIn" | "signMessage";

function featureNames(wallet: WalletLike): readonly string[] {
  return Array.isArray(wallet.features) ? wallet.features : Object.keys(wallet.features);
}

function transactionVersions(wallet: WalletLike): readonly TransactionVersion[] {
  if (Array.isArray(wallet.features)) return [];
  const feature = (wallet.features as Record<string, unknown>)["solana:signTransaction"] as
    { supportedTransactionVersions?: readonly TransactionVersion[] } | undefined;
  return feature?.supportedTransactionVersions ?? [];
}

export function walletCapabilities(wallet: WalletLike): WalletCapabilities {
  const names = new Set(featureNames(wallet));
  const signTransaction = names.has("solana:signTransaction");
  return {
    connect: names.has("standard:connect"),
    disconnect: names.has("standard:disconnect"),
    signTransaction,
    supportedTransactionVersions: signTransaction ? transactionVersions(wallet) : [],
    signMessage: names.has("solana:signMessage"),
    signIn: names.has("solana:signIn"),
    solanaChains: wallet.chains.filter((chain) => chain.startsWith("solana:")),
  };
}

/** D-26, every user: standard:connect, solana:signTransaction and at least one solana: chain. */
export function canBeOffered(capabilities: WalletCapabilities): boolean {
  return (
    capabilities.connect && capabilities.signTransaction && capabilities.solanaChains.length > 0
  );
}

/** D-15: solana:signIn when available, otherwise solana:signMessage; null when the wallet has neither. */
export function signInMethod(capabilities: WalletCapabilities): SignInMethod | null {
  if (capabilities.signIn) return "signIn";
  if (capabilities.signMessage) return "signMessage";
  return null;
}

/**
 * D-26, owners and anyone holding confidential balances: additionally solana:signMessage, because the
 * confidential keys are derived from a signature (D-03). Determinism is checked when keys are derived.
 */
export function canHoldConfidentialBalances(capabilities: WalletCapabilities): boolean {
  return canBeOffered(capabilities) && capabilities.signMessage;
}

/** D-26: v1 single transaction plans when the wallet declares version 1, otherwise v0 plans. */
export function transactionPath(capabilities: WalletCapabilities): "v1" | "v0" {
  return capabilities.supportedTransactionVersions.includes(1) ? "v1" : "v0";
}
