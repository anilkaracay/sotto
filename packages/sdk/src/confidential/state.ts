// Public state of token accounts (06 sections 3 and 4, AC-03.3, AC-03.4, AC-04.3, AC-05.1), read with any
// RPC and no keys: the page, the server check of POST /api/token-accounts and the worker's credit
// counter flag use it. Also the confidential deposit, which needs no keys (the deposited amount is
// public, facts A2). No zk-sdk here: this module loads without the WASM.
import {
  findAssociatedTokenPda,
  getConfidentialDepositInstruction,
  getMintDecoder as getMint2022Decoder,
  getTokenDecoder as getToken2022Decoder,
  TOKEN_2022_PROGRAM_ADDRESS,
  type Token,
} from "@solana-program/token-2022";
import { getMintDecoder, getTokenDecoder, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import {
  fetchEncodedAccount,
  parseBase64RpcAccount,
  type Address,
  type GetAccountInfoApi,
  type Instruction,
  type MaybeEncodedAccount,
  type Rpc,
  type TransactionSigner,
} from "@solana/kit";

export type ConfidentialState = {
  elgamalPubkey: Address;
  approved: boolean;
  allowConfidentialCredits: boolean;
  allowNonConfidentialCredits: boolean;
  pendingBalanceCreditCounter: bigint;
  maximumPendingBalanceCreditCounter: bigint;
  /**
   * Step 4.11: the pending credit counter as it stood at the last apply, 0 while nothing was ever
   * applied. Public, like the counters above: with the pending counter it tells whether the account
   * ever took a deposit or a transfer and whether one still waits, without any key (facts O7).
   */
  appliedPendingBalanceCreditCounter: bigint;
};

export type TokenAccountState =
  | { status: "missing"; address: Address }
  /** The account exists but belongs to a program other than Token-2022. */
  | { status: "other_program"; address: Address; programAddress: Address }
  | {
      status: "present";
      address: Address;
      owner: Address;
      mint: Address;
      /** The public balance in base units. */
      amount: bigint;
      /** Null when the account has no ConfidentialTransferAccount extension. */
      confidential: ConfidentialState | null;
    };

export type ConfidentialAccountErrorReason =
  | "wrong_owner"
  | "not_confidential"
  | "key_mismatch"
  /** Step 1.9: the recipient's account cannot receive this confidential transfer now. */
  | "recipient_not_ready"
  /** Step 1.9: the available balance is below the amount. */
  | "insufficient_balance";

export class ConfidentialAccountError extends Error {
  readonly reason: ConfidentialAccountErrorReason;
  constructor(reason: ConfidentialAccountErrorReason, message: string) {
    super(message);
    this.name = "ConfidentialAccountError";
    this.reason = reason;
  }
}

export function confidentialExtension(token: Token) {
  const extensions = token.extensions.__option === "Some" ? token.extensions.value : [];
  for (const extension of extensions) {
    if (extension.__kind === "ConfidentialTransferAccount") return extension;
  }
  return null;
}

/**
 * A Token-2022 account's data, decoded. The crypto worker gets the bytes from the page, which reads
 * the chain; the worker itself makes no network calls.
 */
export function decodeToken2022Account(data: Uint8Array): Token {
  return getToken2022Decoder().decode(data);
}

/** A Token-2022 mint's data, decoded (step 1.9: the transfer plan reads its auditor setting). */
export function decodeToken2022Mint(data: Uint8Array) {
  return getMint2022Decoder().decode(data);
}

/**
 * The public state of an account as the RPC returned it: missing, owned by another program, or a
 * decoded Token-2022 account. Only Token-2022 data is decoded.
 */
export function tokenAccountState(account: MaybeEncodedAccount): TokenAccountState {
  if (!account.exists) return { status: "missing", address: account.address };
  if (account.programAddress !== TOKEN_2022_PROGRAM_ADDRESS) {
    return {
      status: "other_program",
      address: account.address,
      programAddress: account.programAddress,
    };
  }
  const token = decodeToken2022Account(new Uint8Array(account.data));
  const extension = confidentialExtension(token);
  return {
    status: "present",
    address: account.address,
    owner: token.owner,
    mint: token.mint,
    amount: token.amount,
    confidential: extension
      ? {
          elgamalPubkey: extension.elgamalPubkey,
          approved: extension.approved,
          allowConfidentialCredits: extension.allowConfidentialCredits,
          allowNonConfidentialCredits: extension.allowNonConfidentialCredits,
          pendingBalanceCreditCounter: extension.pendingBalanceCreditCounter,
          maximumPendingBalanceCreditCounter: extension.maximumPendingBalanceCreditCounter,
          appliedPendingBalanceCreditCounter: extension.actualPendingBalanceCreditCounter,
        }
      : null,
  };
}

/** Reads an account's public state. It only reads; it needs no keys. */
export async function readTokenAccountState(
  rpc: Rpc<GetAccountInfoApi>,
  address: Address,
): Promise<TokenAccountState> {
  return tokenAccountState(await fetchEncodedAccount(rpc, address, { commitment: "confirmed" }));
}

/**
 * The same with the slot of the read (08 POST /token-accounts records it: the account was configured
 * at or before that slot).
 */
export async function readTokenAccountStateWithSlot(
  rpc: Rpc<GetAccountInfoApi>,
  address: Address,
): Promise<{ state: TokenAccountState; slot: bigint }> {
  const { context, value } = await rpc
    .getAccountInfo(address, { encoding: "base64", commitment: "confirmed" })
    .send();
  return { state: tokenAccountState(parseBase64RpcAccount(address, value)), slot: context.slot };
}

export type PublicTokenBalance =
  | { status: "missing"; address: Address }
  | { status: "present"; address: Address; programAddress: Address; owner: Address; amount: bigint }
  | { status: "invalid"; address: Address; reason: string };

/**
 * The public balance of an SPL Token or Token-2022 account (USDC is an SPL Token mint, wUSDC a
 * Token-2022 mint). A missing account holds nothing; the caller says so rather than showing a number
 * for an account that does not exist.
 */
export async function readPublicTokenBalance(
  rpc: Rpc<GetAccountInfoApi>,
  address: Address,
): Promise<PublicTokenBalance> {
  const account = await fetchEncodedAccount(rpc, address, { commitment: "confirmed" });
  if (!account.exists) return { status: "missing", address };
  const data = new Uint8Array(account.data);
  if (account.programAddress === TOKEN_PROGRAM_ADDRESS) {
    const token = getTokenDecoder().decode(data);
    return {
      status: "present",
      address,
      programAddress: account.programAddress,
      owner: token.owner,
      amount: token.amount,
    };
  }
  if (account.programAddress === TOKEN_2022_PROGRAM_ADDRESS) {
    const token = getToken2022Decoder().decode(data);
    return {
      status: "present",
      address,
      programAddress: account.programAddress,
      owner: token.owner,
      amount: token.amount,
    };
  }
  return { status: "invalid", address, reason: "it is not a token account" };
}

export type AccountCheck =
  | { ok: true; confidential: ConfidentialState }
  | {
      ok: false;
      reason:
        | "missing"
        | "not_token_2022"
        | "wrong_owner"
        | "wrong_mint"
        | "not_confidential"
        | "not_approved";
    };

/**
 * 06 section 3, step 4 and 08 POST /token-accounts: the account exists, is a Token-2022 account of the
 * expected owner and mint, and has an approved ConfidentialTransferAccount extension.
 */
export function checkConfidentialAccount(
  state: TokenAccountState,
  expected: { owner: Address; mint: Address },
): AccountCheck {
  if (state.status === "missing") return { ok: false, reason: "missing" };
  if (state.status === "other_program") return { ok: false, reason: "not_token_2022" };
  if (state.owner !== expected.owner) return { ok: false, reason: "wrong_owner" };
  if (state.mint !== expected.mint) return { ok: false, reason: "wrong_mint" };
  if (!state.confidential) return { ok: false, reason: "not_confidential" };
  if (!state.confidential.approved) return { ok: false, reason: "not_approved" };
  return { ok: true, confidential: state.confidential };
}

export type AccountSetupStatus =
  | { kind: "needs_setup"; created: boolean }
  | { kind: "configured"; confidential: ConfidentialState }
  | { kind: "other_key"; onchain: Address }
  | { kind: "not_approved" }
  | { kind: "wrong_account"; reason: "not_token_2022" | "wrong_owner" | "wrong_mint" };

/**
 * What account setup still has to do (06 section 3, idempotent): nothing when the account is
 * configured with the owner's key; stop with a clear error when it is configured with another key.
 */
export function accountSetupStatus(
  state: TokenAccountState,
  expected: { owner: Address; mint: Address; elgamalPubkey: Address },
): AccountSetupStatus {
  const check = checkConfidentialAccount(state, expected);
  if (check.ok) {
    return check.confidential.elgamalPubkey === expected.elgamalPubkey
      ? { kind: "configured", confidential: check.confidential }
      : { kind: "other_key", onchain: check.confidential.elgamalPubkey };
  }
  switch (check.reason) {
    case "missing":
      return { kind: "needs_setup", created: false };
    case "not_confidential":
      return { kind: "needs_setup", created: true };
    case "not_approved":
      return { kind: "not_approved" };
    default:
      return { kind: "wrong_account", reason: check.reason };
  }
}

/** A mint's token program and decimals (SPL Token or Token-2022), or null when it does not exist. */
export async function readMintInfo(
  rpc: Rpc<GetAccountInfoApi>,
  mint: Address,
): Promise<{ programAddress: Address; decimals: number } | null> {
  const account = await fetchEncodedAccount(rpc, mint, { commitment: "confirmed" });
  if (!account.exists) return null;
  const data = new Uint8Array(account.data);
  if (account.programAddress === TOKEN_PROGRAM_ADDRESS) {
    return {
      programAddress: account.programAddress,
      decimals: getMintDecoder().decode(data).decimals,
    };
  }
  if (account.programAddress === TOKEN_2022_PROGRAM_ADDRESS) {
    return {
      programAddress: account.programAddress,
      decimals: getMint2022Decoder().decode(data).decimals,
    };
  }
  return null;
}

export type RecipientReadiness = "no_account" | "not_configured" | "ready";

/**
 * AC-07.2: a recipient's readiness from the public state of their associated wUSDC account (06
 * section 5 preconditions): no account, an account that cannot receive confidential payments (no
 * approved extension, confidential credits off, or not the recipient's wUSDC account), or ready.
 */
export function recipientReadiness(
  state: TokenAccountState,
  expected: { owner: Address; mint: Address },
): RecipientReadiness {
  if (state.status === "missing") return "no_account";
  if (state.status === "other_program") return "not_configured";
  if (state.owner !== expected.owner || state.mint !== expected.mint) return "not_configured";
  const confidential = state.confidential;
  if (!confidential?.approved || !confidential.allowConfidentialCredits) return "not_configured";
  return "ready";
}

/** AC-04.3: the worker flags accounts whose credit counter is at or above 80 percent of its maximum. */
export const APPLY_FLAG_PERCENT = 80n;

export function creditCounterNeedsApply(state: ConfidentialState): boolean {
  if (state.maximumPendingBalanceCreditCounter <= 0n) return false;
  return (
    state.pendingBalanceCreditCounter * 100n >=
    state.maximumPendingBalanceCreditCounter * APPLY_FLAG_PERCENT
  );
}

/** The owner's associated account for a mint under a token program (Token-2022 by default). */
export async function associatedTokenAccount(
  owner: Address,
  mint: Address,
  tokenProgram: Address = TOKEN_2022_PROGRAM_ADDRESS,
): Promise<Address> {
  const [token] = await findAssociatedTokenPda({ owner, mint, tokenProgram });
  return token;
}

/** 06 section 4, step 2: public wUSDC into the pending balance. The amount is public by design. */
export function confidentialDepositInstruction(input: {
  token: Address;
  mint: Address;
  owner: TransactionSigner;
  amount: bigint;
  decimals: number;
}): Instruction {
  return getConfidentialDepositInstruction({
    token: input.token,
    mint: input.mint,
    authority: input.owner,
    amount: input.amount,
    decimals: input.decimals,
  });
}
