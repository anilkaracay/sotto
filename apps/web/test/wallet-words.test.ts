// The wallet's own words next to Sotto's explanation (Q-15, founder 2026-09-29; step 2.1): for every
// wallet and every request, an error the wallet raised is shown with the wallet's name and the
// error's name, text and code; errors that are not the wallet's keep Sotto's words alone.
import { SimulationFailedError, WalletSigningError } from "@sotto/sdk/tx";
import { describe, expect, it } from "vitest";
import { describeWalletError, SignInError } from "../lib/client/auth.ts";
import {
  describeTransactionError,
  isWalletCancel,
  SETUP_BLOCKED,
  WALLET_REFUSED_TRANSACTION,
} from "../lib/client/transactions.ts";
import {
  fromWallet,
  walletWords,
  WalletRequestError,
  withWalletWords,
} from "../lib/client/wallet-words.ts";

const named = (name: string, message: string, code?: number | string) =>
  Object.assign(new Error(message), { name, ...(code === undefined ? {} : { code }) });

describe("the wallet's own words (Q-15)", () => {
  it("Q-15 takes the wallet's error name, text and code, cleaned, whatever the wallet threw", () => {
    expect(
      walletWords("Backpack", named("WalletSignTransactionError", "Transaction blocked")),
    ).toEqual({ wallet: "Backpack", text: "WalletSignTransactionError: Transaction blocked" });
    expect(walletWords("Phantom", named("Error", "User rejected the request.", 4001))).toEqual({
      wallet: "Phantom",
      text: "User rejected the request. (code 4001)",
    });
    expect(walletWords("Solflare", "plain\ntext\u0007 reason").text).toBe("plain text reason");
    expect(walletWords("Solflare", { message: "an object" }).text).toBe("an object");
    expect(walletWords("Solflare", undefined).text).toBe("");
    expect(walletWords("  ", new Error("x")).wallet).toBe("Your wallet");
    const long = walletWords("Solflare", new Error("y".repeat(400))).text;
    expect(long).toHaveLength(300);
    expect(long.endsWith("…")).toBe(true);
    // Wrapped by Sotto: the wallet's own error is what counts.
    expect(walletWords("Backpack", new WalletSigningError(named("E", "blocked"))).text).toBe(
      "E: blocked",
    );
    expect(walletWords("Backpack", new WalletRequestError(new Error("nope"))).text).toBe("nope");
  });

  it("Q-15 puts the wallet's words after Sotto's explanation, and says when the wallet gave none", () => {
    expect(withWalletWords("Nothing was sent.", { wallet: "Backpack", text: "blocked" })).toBe(
      'Nothing was sent. Backpack said: "blocked"',
    );
    expect(withWalletWords("Nothing was sent.", { wallet: "Backpack", text: "" })).toBe(
      "Nothing was sent. Backpack gave no error message.",
    );
    expect(withWalletWords("Nothing was sent.", null)).toBe("Nothing was sent.");
  });

  it("Q-15 shows a transaction the wallet refused or cancelled with its words, and other errors without", () => {
    const refused = new WalletSigningError(
      named("WalletSignTransactionError", "Transaction blocked"),
    );
    expect(describeTransactionError(refused, "Backpack")).toBe(
      `${WALLET_REFUSED_TRANSACTION} Backpack said: "WalletSignTransactionError: Transaction blocked"`,
    );
    const cancelled = new WalletSigningError(named("Error", "User rejected the request.", 4001));
    expect(isWalletCancel(cancelled)).toBe(true);
    expect(describeTransactionError(cancelled, "Phantom")).toBe(
      'You cancelled in your wallet. Nothing was sent. Phantom said: "User rejected the request. (code 4001)"',
    );
    // The account setup's own words for a refusal (the neutral capability message), never a name.
    expect(describeTransactionError(refused, "Backpack", { refused: SETUP_BLOCKED })).toBe(
      `${SETUP_BLOCKED} Backpack said: "WalletSignTransactionError: Transaction blocked"`,
    );
    expect(SETUP_BLOCKED).not.toMatch(/backpack|phantom|solflare/i);
    // True for any refusal, not only a security block (founder, step 2.2).
    expect(SETUP_BLOCKED).toBe(
      "Your wallet did not sign this confidential account setup. If your wallet mentions a security check, try another Solana wallet or contact your wallet's support.",
    );
    expect(describeTransactionError(cancelled, "Phantom", { refused: SETUP_BLOCKED })).toMatch(
      /^You cancelled in your wallet\. Nothing was sent\./,
    );
    // Not the wallet's error: no wallet words.
    const simulation = new SimulationFailedError(
      { InstructionError: [0, "InvalidAccountData"] },
      [],
      [],
    );
    expect(describeTransactionError(simulation, "Backpack")).not.toContain("Backpack said");
    expect(describeTransactionError(new Error("socket hang up"), "Backpack")).toBe(
      "The transaction could not be completed. Check your balances, then try again.",
    );
  });

  it("Q-15 shows a refused connect or sign in with the wallet's words, a server refusal with the server's", async () => {
    const refusal = await fromWallet(async () => {
      throw named("WalletSignInError", "Sign in is not available");
    }).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(WalletRequestError);
    expect(describeWalletError(refusal, "Backpack")).toBe(
      'The wallet could not sign in. Try again, or choose another wallet. Backpack said: "WalletSignInError: Sign in is not available"',
    );
    const cancelled = new WalletRequestError(new Error("User declined"));
    expect(describeWalletError(cancelled, "Solflare")).toBe(
      'Sign in was cancelled in your wallet. Solflare said: "User declined"',
    );
    expect(
      describeWalletError(new SignInError("nonce_expired", "The sign in message expired.")),
    ).toBe("The sign in message expired.");
    // A network failure is not the wallet's.
    expect(describeWalletError(new TypeError("Failed to fetch"), "Solflare")).toBe(
      "Sign in could not be completed. Check your connection and try again.",
    );
  });
});
