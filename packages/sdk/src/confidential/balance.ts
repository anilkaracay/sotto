// A confidential balance read with the owner's keys (06 section 1, AC-03.4, scripts/recover-balance.ts):
// the token account's ConfidentialTransferAccount extension is decrypted with the standard_v1 keys, and
// only after its ElGamal key matches the derived one (I-5). Call it where the keys already live (the
// crypto worker, or a local script with the owner's keypair).
import {
  fetchMint,
  fetchToken,
  findAssociatedTokenPda,
  TOKEN_2022_PROGRAM_ADDRESS,
  type Token,
} from "@solana-program/token-2022";
import { decryptConfidentialTransferBalance } from "@solana-program/token-2022/confidential";
import type { Address } from "@solana/kit";
import { AeKey, ElGamalSecretKey } from "@solana/zk-sdk/bundler";
import { elgamalKeyMatches, type ConfidentialKeyMaterial } from "../keys/confidential.ts";

export type ConfidentialBalance = {
  token: Address;
  owner: Address;
  mint: Address;
  decimals: number;
  /** Whether `token` is the owner's associated token account for the mint. */
  associated: boolean;
  /** Decrypted from the decryptable available balance with the AES key (facts A4). */
  available: bigint;
  /** Decrypted from the pending balance with the ElGamal secret key. */
  pending: bigint;
  pendingCredits: bigint;
};

export class ConfidentialAccountError extends Error {
  readonly reason: "wrong_owner" | "not_confidential" | "key_mismatch";
  constructor(reason: "wrong_owner" | "not_confidential" | "key_mismatch", message: string) {
    super(message);
    this.name = "ConfidentialAccountError";
    this.reason = reason;
  }
}

type ReadRpc = Parameters<typeof fetchToken>[0] & Parameters<typeof fetchMint>[0];

function confidentialExtension(token: Token) {
  const extensions = token.extensions.__option === "Some" ? token.extensions.value : [];
  for (const extension of extensions) {
    if (extension.__kind === "ConfidentialTransferAccount") return extension;
  }
  return null;
}

/** Reads and decrypts a confidential balance. It only reads accounts; it signs and sends nothing. */
export async function readConfidentialBalance(input: {
  rpc: ReadRpc;
  token: Address;
  owner: Address;
  keys: ConfidentialKeyMaterial;
}): Promise<ConfidentialBalance> {
  const account = await fetchToken(input.rpc, input.token);
  if (account.data.owner !== input.owner) {
    throw new ConfidentialAccountError(
      "wrong_owner",
      `The token account ${input.token} belongs to ${account.data.owner}, not to ${input.owner}`,
    );
  }
  const extension = confidentialExtension(account.data);
  if (!extension) {
    throw new ConfidentialAccountError(
      "not_confidential",
      `The token account ${input.token} has no confidential balance`,
    );
  }
  if (!elgamalKeyMatches(input.keys.elgamalPubkey, extension.elgamalPubkey)) {
    throw new ConfidentialAccountError(
      "key_mismatch",
      "The keys this wallet derives do not match the account's ElGamal key: wrong wallet or keys other than the standard ones",
    );
  }
  const elgamalSecretKey = ElGamalSecretKey.fromBytes(new Uint8Array(input.keys.elgamalSecretKey));
  const aesKey = AeKey.fromBytes(new Uint8Array(input.keys.aeKey));
  try {
    const balance = decryptConfidentialTransferBalance({
      tokenAccount: account.data,
      elgamalSecretKey,
      aesKey,
    });
    const mint = await fetchMint(input.rpc, account.data.mint);
    const [associated] = await findAssociatedTokenPda({
      owner: input.owner,
      mint: account.data.mint,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    });
    return {
      token: input.token,
      owner: input.owner,
      mint: account.data.mint,
      decimals: mint.data.decimals,
      associated: associated === input.token,
      available: balance.availableBalance,
      pending: balance.pendingBalance,
      pendingCredits: balance.pendingBalanceCreditCounter,
    };
  } finally {
    elgamalSecretKey.free();
    aesKey.free();
  }
}

/** An amount in base units as a decimal number of tokens, exactly (no floating point). */
export function formatTokenAmount(baseUnits: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0)
    throw new Error("decimals must be a whole number");
  const negative = baseUnits < 0n;
  const digits = (negative ? -baseUnits : baseUnits).toString().padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals > 0 ? digits.slice(-decimals).replace(/0+$/, "") : "";
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** The owner's associated Token-2022 account for a mint (where the spl-token CLI looks by default). */
export async function associatedTokenAccount(owner: Address, mint: Address): Promise<Address> {
  const [token] = await findAssociatedTokenPda({
    owner,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });
  return token;
}
