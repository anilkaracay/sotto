// The key free part of the confidential accounts module (step 1.7): account state, the checks of 06
// section 3 and 08 POST /token-accounts, the 80 percent credit counter rule (AC-04.3), public token
// balances and typed amounts.
import {
  AccountState,
  getTokenEncoder as getToken2022Encoder,
  TOKEN_2022_PROGRAM_ADDRESS,
  type Token,
} from "@solana-program/token-2022";
import { getTokenEncoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  address,
  getBase64Decoder,
  none,
  some,
  type Address,
  type MaybeAccount,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  accountSetupStatus,
  checkConfidentialAccount,
  creditCounterNeedsApply,
  parseTokenAmount,
  readPublicTokenBalance,
  tokenAccountState,
  type ConfidentialState,
} from "../src/confidential/public.ts";

const OWNER = address("EQMW3o1DVsB72Ej1RRRmHLW1XaEpbjLKrMHUbS8cRLZC");
const MINT = address("AhJfP4JJBaHWRtXRiaScZUC7SMm4RqUPSb3g9H5RT8Bd");
const TOKEN = address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
const KEY = address("BxMVLbjVntF9DJtDjfpQLrgw4hopedMgNkZZKGcVkZp6");
const OTHER = address("7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L");

const ZERO_CIPHERTEXT = new Uint8Array(64);

function token(extension: Partial<ConfidentialState> | null, overrides: Partial<Token> = {}) {
  return {
    mint: MINT,
    owner: OWNER,
    amount: 7n,
    delegate: none(),
    state: AccountState.Initialized,
    isNative: none(),
    delegatedAmount: 0n,
    closeAuthority: none(),
    extensions: extension
      ? some([
          {
            __kind: "ConfidentialTransferAccount" as const,
            approved: true,
            elgamalPubkey: KEY,
            pendingBalanceLow: ZERO_CIPHERTEXT,
            pendingBalanceHigh: ZERO_CIPHERTEXT,
            availableBalance: ZERO_CIPHERTEXT,
            decryptableAvailableBalance: new Uint8Array(36),
            allowConfidentialCredits: true,
            allowNonConfidentialCredits: true,
            pendingBalanceCreditCounter: 0n,
            maximumPendingBalanceCreditCounter: 65_536n,
            expectedPendingBalanceCreditCounter: 0n,
            actualPendingBalanceCreditCounter: 0n,
            ...extension,
          },
        ])
      : none(),
    ...overrides,
  } as Token;
}

function present(data: Token, programAddress: Address = TOKEN_2022_PROGRAM_ADDRESS) {
  return tokenAccountState({
    exists: true,
    address: TOKEN,
    programAddress,
    data,
    executable: false,
    lamports: 1n,
    space: 0n,
  } as unknown as MaybeAccount<Token>);
}

const missing = tokenAccountState({ exists: false, address: TOKEN } as MaybeAccount<Token>);
const expected = { owner: OWNER, mint: MINT };

describe("token account state and checks (06 section 3)", () => {
  it("reads the public state, with the confidential extension when it exists", () => {
    expect(missing).toEqual({ status: "missing", address: TOKEN });
    expect(present(token(null))).toMatchObject({
      status: "present",
      owner: OWNER,
      mint: MINT,
      amount: 7n,
      confidential: null,
    });
    expect(present(token({ pendingBalanceCreditCounter: 3n }))).toMatchObject({
      confidential: {
        elgamalPubkey: KEY,
        approved: true,
        pendingBalanceCreditCounter: 3n,
        maximumPendingBalanceCreditCounter: 65_536n,
      },
    });
  });

  it("accepts only an approved confidential Token-2022 account of the owner and the mint", () => {
    expect(checkConfidentialAccount(present(token({})), expected)).toMatchObject({ ok: true });
    expect(checkConfidentialAccount(missing, expected)).toEqual({ ok: false, reason: "missing" });
    expect(checkConfidentialAccount(present(token({}), TOKEN_PROGRAM_ADDRESS), expected)).toEqual({
      ok: false,
      reason: "not_token_2022",
    });
    expect(checkConfidentialAccount(present(token({}, { owner: OTHER })), expected)).toEqual({
      ok: false,
      reason: "wrong_owner",
    });
    expect(checkConfidentialAccount(present(token({}, { mint: OTHER })), expected)).toEqual({
      ok: false,
      reason: "wrong_mint",
    });
    expect(checkConfidentialAccount(present(token(null)), expected)).toEqual({
      ok: false,
      reason: "not_confidential",
    });
    expect(checkConfidentialAccount(present(token({ approved: false })), expected)).toEqual({
      ok: false,
      reason: "not_approved",
    });
  });

  it("AC-03.3 skips a configured account and stops at an account configured with another key", () => {
    const withKey = { ...expected, elgamalPubkey: KEY };
    expect(accountSetupStatus(missing, withKey)).toEqual({ kind: "needs_setup", created: false });
    expect(accountSetupStatus(present(token(null)), withKey)).toEqual({
      kind: "needs_setup",
      created: true,
    });
    expect(accountSetupStatus(present(token({})), withKey)).toMatchObject({ kind: "configured" });
    expect(accountSetupStatus(present(token({ elgamalPubkey: OTHER })), withKey)).toEqual({
      kind: "other_key",
      onchain: OTHER,
    });
    expect(accountSetupStatus(present(token({ approved: false })), withKey)).toEqual({
      kind: "not_approved",
    });
    expect(accountSetupStatus(present(token({}, { owner: OTHER })), withKey)).toEqual({
      kind: "wrong_account",
      reason: "wrong_owner",
    });
  });

  it("AC-04.3 flags a credit counter at or above 80 percent of its maximum", () => {
    const state = (counter: bigint, maximum: bigint) =>
      ({
        pendingBalanceCreditCounter: counter,
        maximumPendingBalanceCreditCounter: maximum,
      }) as ConfidentialState;
    expect(creditCounterNeedsApply(state(79n, 100n))).toBe(false);
    expect(creditCounterNeedsApply(state(80n, 100n))).toBe(true);
    expect(creditCounterNeedsApply(state(3n, 5n))).toBe(false);
    expect(creditCounterNeedsApply(state(4n, 5n))).toBe(true);
    expect(creditCounterNeedsApply(state(52_428n, 65_536n))).toBe(false);
    expect(creditCounterNeedsApply(state(52_429n, 65_536n))).toBe(true);
    expect(creditCounterNeedsApply(state(0n, 0n))).toBe(false);
  });
});

describe("typed amounts", () => {
  it("parses decimal text into base units exactly, and refuses anything else", () => {
    expect(parseTokenAmount("1", 6)).toBe(1_000_000n);
    expect(parseTokenAmount(" 2.5 ", 6)).toBe(2_500_000n);
    expect(parseTokenAmount("0.000001", 6)).toBe(1n);
    expect(parseTokenAmount("01", 6)).toBe(1_000_000n);
    expect(parseTokenAmount("123456789012345.123456", 6)).toBe(123_456_789_012_345_123_456n);
    for (const text of [
      "0",
      "0.0",
      "",
      "1.1234567",
      "-1",
      "1e5",
      "1,5",
      "abc",
      ".5",
      "1.",
      "1234567890123456",
    ]) {
      expect(parseTokenAmount(text, 6), text).toBeNull();
    }
    expect(parseTokenAmount("3", 0)).toBe(3n);
    expect(parseTokenAmount("3.1", 0)).toBeNull();
  });
});

describe("public token balances (AC-03.4, AC-05.1)", () => {
  function rpcWith(account: { owner: Address; data: Uint8Array } | null) {
    return {
      getAccountInfo: () => ({
        send: async () => ({
          context: { slot: 1n },
          value: account
            ? {
                data: [getBase64Decoder().decode(account.data), "base64"],
                executable: false,
                lamports: 2_039_280n,
                owner: account.owner,
                space: BigInt(account.data.length),
                rentEpoch: 0n,
              }
            : null,
        }),
      }),
    } as never;
  }

  it("reads SPL Token and Token-2022 accounts and says when an account is missing", async () => {
    const spl = getTokenEncoder().encode({
      mint: MINT,
      owner: OWNER,
      amount: 5_000_000n,
      delegate: none(),
      state: AccountState.Initialized,
      isNative: none(),
      delegatedAmount: 0n,
      closeAuthority: none(),
    });
    expect(
      await readPublicTokenBalance(
        rpcWith({ owner: TOKEN_PROGRAM_ADDRESS, data: new Uint8Array(spl) }),
        TOKEN,
      ),
    ).toEqual({
      status: "present",
      address: TOKEN,
      programAddress: TOKEN_PROGRAM_ADDRESS,
      owner: OWNER,
      amount: 5_000_000n,
    });
    const t22 = getToken2022Encoder().encode(token({}, { amount: 9n }));
    expect(
      await readPublicTokenBalance(
        rpcWith({ owner: TOKEN_2022_PROGRAM_ADDRESS, data: new Uint8Array(t22) }),
        TOKEN,
      ),
    ).toMatchObject({ status: "present", amount: 9n, programAddress: TOKEN_2022_PROGRAM_ADDRESS });
    expect(await readPublicTokenBalance(rpcWith(null), TOKEN)).toEqual({
      status: "missing",
      address: TOKEN,
    });
    expect(
      await readPublicTokenBalance(rpcWith({ owner: OTHER, data: new Uint8Array(165) }), TOKEN),
    ).toMatchObject({ status: "invalid" });
  });
});
