// The wallet's own words (Q-15, founder 2026-09-29; step 2.1): whenever a wallet raises an error, the
// page shows the wallet's name and the error's name and text next to Sotto's explanation, for every
// wallet and every request (connect, sign in, message and transaction signatures). The text is the
// wallet's, shown as plain text in this tab and never sent anywhere.
import { WalletSigningError } from "@sotto/sdk/tx";

/** An error a wallet raised for a request the page made to it directly (connect, sign in, messages). */
export class WalletRequestError extends Error {
  constructor(cause: unknown) {
    super("the wallet did not complete the request", { cause });
    this.name = "WalletRequestError";
  }
}

/** Runs one request to the wallet; whatever it throws comes back as a WalletRequestError. */
export async function fromWallet<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    throw new WalletRequestError(error);
  }
}

export function isWalletError(error: unknown): error is WalletRequestError | WalletSigningError {
  return error instanceof WalletRequestError || error instanceof WalletSigningError;
}

/** The error the wallet itself raised, when Sotto wrapped it, or the error as it is. */
export function walletCause(error: unknown): unknown {
  return isWalletError(error) ? error.cause : error;
}

export type WalletWords = { wallet: string; text: string };

const MAX_TEXT = 300;

/** The wallet's name and its error's name, text and code, cleaned for display. */
export function walletWords(wallet: string, error: unknown): WalletWords {
  const cause = walletCause(error);
  let text = "";
  if (cause instanceof Error) {
    const name = cause.name && cause.name !== "Error" ? `${cause.name}: ` : "";
    text = `${name}${cause.message}`;
  } else if (typeof cause === "string") {
    text = cause;
  } else if (typeof cause === "object" && cause !== null && "message" in cause) {
    text = String((cause as { message: unknown }).message);
  }
  const code =
    typeof cause === "object" && cause !== null && "code" in cause
      ? (cause as { code: unknown }).code
      : undefined;
  if ((typeof code === "number" || typeof code === "string") && String(code) !== "") {
    text = `${text} (code ${String(code)})`;
  }
  text = text
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT - 1)}…`;
  return { wallet: wallet.trim() || "Your wallet", text };
}

/** Sotto's explanation, then what the wallet said. */
export function withWalletWords(explanation: string, words: WalletWords | null): string {
  if (!words) return explanation;
  return words.text
    ? `${explanation} ${words.wallet} said: "${words.text}"`
    : `${explanation} ${words.wallet} gave no error message.`;
}
