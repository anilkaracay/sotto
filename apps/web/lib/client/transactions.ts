// Plain words for what can go wrong around a wallet signed transaction (09 section 4: chain errors
// are decoded to plain language). Since step 2.1 (Q-15) an error the wallet raised is shown with the
// wallet's own words next to Sotto's explanation (wallet-words.ts).
import {
  decodeTransactionError,
  isRateLimited,
  SimulationFailedError,
  TransactionFailedError,
  WALLET_CHANGED_TRANSACTION,
  WalletChangedTransactionError,
  WalletSigningError,
} from "@sotto/sdk/tx";
import { isWalletError, walletCause, walletWords, withWalletWords } from "./wallet-words.ts";

/** A wallet error that reads as the user saying no, as sign in treats it (lib/client/auth.ts). */
export function isWalletCancel(error: unknown): boolean {
  const cause = walletCause(error);
  const text = cause instanceof Error ? `${cause.name} ${cause.message}` : String(cause);
  return /reject|denied|cancel|declin/i.test(text);
}

/**
 * Why the wallet refused a transaction it did not sign: the transaction had passed Sotto's
 * simulation, so the refusal is the wallet's own (its words follow).
 */
export const WALLET_REFUSED_TRANSACTION =
  "Your wallet did not sign the transaction, so nothing was sent. Sotto had simulated it on this network and it would have succeeded, so the refusal comes from the wallet itself.";

/** `wallet` is the wallet's name (Wallet Standard), for its own words in the message. */
export function describeTransactionError(error: unknown, wallet?: string): string {
  if (error instanceof WalletChangedTransactionError) return WALLET_CHANGED_TRANSACTION;
  if (error instanceof SimulationFailedError) {
    return `The transaction would fail, so it was not sent: ${error.decoded.message}`;
  }
  if (error instanceof TransactionFailedError) {
    return `The transaction failed onchain: ${decodeTransactionError(error.err).message}`;
  }
  if (isWalletError(error)) {
    const words = walletWords(wallet ?? "Your wallet", error);
    if (isWalletCancel(error)) {
      return withWalletWords("You cancelled in your wallet. Nothing was sent.", words);
    }
    return withWalletWords(
      error instanceof WalletSigningError
        ? WALLET_REFUSED_TRANSACTION
        : "Your wallet could not complete the request, so nothing was sent.",
      words,
    );
  }
  if (isWalletCancel(error)) return "You cancelled in your wallet. Nothing was sent.";
  if (isRateLimited(error)) return "The network is busy. Try again in a moment.";
  return "The transaction could not be completed. Check your balances, then try again.";
}
