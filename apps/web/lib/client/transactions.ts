// Plain words for what can go wrong around a wallet signed transaction (09 section 4: chain errors
// are decoded to plain language).
import {
  decodeTransactionError,
  isRateLimited,
  SimulationFailedError,
  TransactionFailedError,
  WALLET_CHANGED_TRANSACTION,
  WalletChangedTransactionError,
} from "@sotto/sdk/tx";

/** A wallet error that reads as the user saying no, as sign in treats it (lib/client/auth.ts). */
export function isWalletCancel(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /reject|denied|cancel|declin/i.test(text);
}

export function describeTransactionError(error: unknown): string {
  if (error instanceof WalletChangedTransactionError) return WALLET_CHANGED_TRANSACTION;
  if (error instanceof SimulationFailedError) {
    return `The transaction would fail, so it was not sent: ${error.decoded.message}`;
  }
  if (error instanceof TransactionFailedError) {
    return `The transaction failed onchain: ${decodeTransactionError(error.err).message}`;
  }
  if (isWalletCancel(error)) return "You cancelled in your wallet. Nothing was sent.";
  if (isRateLimited(error)) return "The network is busy. Try again in a moment.";
  return "The transaction could not be completed. Check your balances, then try again.";
}
