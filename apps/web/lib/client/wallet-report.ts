// Diagnostic reports about what a wallet did with a signing request (06 section 9, POST
// /api/wallet-reports): the wallet's name, the Wallet Standard version it declares and the versions of
// the features Sotto used (the Wallet Standard gives apps no wallet app version). A report never
// blocks the flow and carries no keys, signatures or amounts.
import type { SignedMessageComparison } from "@sotto/sdk/tx";
import { getWalletFeature, type UiWallet } from "@wallet-standard/react";

export type WalletInfo = {
  name: string;
  version: string;
  features: { name: string; version: string }[];
};

const USED_FEATURES = ["solana:signMessage", "solana:signTransaction"] as const;
const VERSION = /^[0-9A-Za-z.+-]{1,16}$/;

export function walletInfo(wallet: UiWallet): WalletInfo {
  return {
    name: wallet.name.slice(0, 64),
    version: VERSION.test(wallet.version) ? wallet.version : "unknown",
    features: USED_FEATURES.filter((name) => wallet.features.includes(name)).map((name) => {
      const { version } = getWalletFeature(wallet, name) as { version?: unknown };
      return {
        name,
        version: typeof version === "string" && VERSION.test(version) ? version : "unknown",
      };
    }),
  };
}

type Report =
  | { kind: "signature_not_deterministic" }
  | {
      kind: "compute_budget_changed";
      changes: { field: string; built: string | null; signed: string | null }[];
    }
  | { kind: "transaction_changed"; reason: string };

export function reportWallet(wallet: WalletInfo, report: Report): void {
  void fetch("/api/wallet-reports", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...report, wallet }),
  }).catch(() => {});
}

/** Records a signed message check that was not identical (06 section 9): budget changes or a refusal. */
export function reportComparison(wallet: WalletInfo, comparison: SignedMessageComparison): void {
  if (comparison.kind === "compute_budget_only" && comparison.changes.length > 0) {
    reportWallet(wallet, {
      kind: "compute_budget_changed",
      changes: comparison.changes.slice(0, 5),
    });
  }
  if (comparison.kind === "changed") {
    const reason = comparison.reason
      .replace(/[^A-Za-z0-9 :,()'.-]/g, " ")
      .slice(0, 120)
      .trim();
    reportWallet(wallet, { kind: "transaction_changed", reason: reason || "unknown" });
  }
}
