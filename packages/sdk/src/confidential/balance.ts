// A confidential balance read with the owner's keys (06 section 1, AC-03.4, scripts/recover-balance.ts):
// the token account's ConfidentialTransferAccount extension is decrypted with the standard_v1 keys, and
// only after its ElGamal key matches the derived one (I-5). Call it where the keys already live (the
// crypto worker, or a local script with the owner's keypair).
import { fetchMint, fetchToken } from "@solana-program/token-2022";
import type { Address } from "@solana/kit";
import type { ConfidentialKeyMaterial } from "../keys/confidential.ts";
import { decryptTokenAccount } from "./account.ts";
import { associatedTokenAccount, ConfidentialAccountError } from "./state.ts";

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

type ReadRpc = Parameters<typeof fetchToken>[0] & Parameters<typeof fetchMint>[0];

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
  const balance = decryptTokenAccount(account.data, input.keys);
  const mint = await fetchMint(input.rpc, account.data.mint);
  const associated = await associatedTokenAccount(input.owner, account.data.mint);
  return {
    token: input.token,
    owner: input.owner,
    mint: account.data.mint,
    decimals: mint.data.decimals,
    associated: associated === input.token,
    available: balance.available,
    pending: balance.pending,
    pendingCredits: balance.pendingBalanceCreditCounter,
  };
}
