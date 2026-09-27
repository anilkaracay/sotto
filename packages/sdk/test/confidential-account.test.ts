// The confidential account work that needs the keys (06 sections 3 and 4, step 1.7): the setup
// instructions of getCreateConfidentialTransferAccountInstructionPlan as portable instructions, the
// decryption of a token account's balances and the apply instruction, each only after the ElGamal key
// matches (I-5). The keys come from the step 1.5 CLI check keypair (test data).
import { createHash } from "node:crypto";
import {
  AccountState,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ADDRESS,
  type Token,
} from "@solana-program/token-2022";
import { ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS } from "@solana-program/zk-elgamal-proof";
import {
  AccountRole,
  address,
  createKeyPairFromPrivateKeyBytes,
  createNoopSigner,
  getAddressEncoder,
  getAddressFromPublicKey,
  none,
  signBytes,
  some,
  type Address,
} from "@solana/kit";
import { AeKey, ElGamalPubkey } from "@solana/zk-sdk/bundler";
import { beforeAll, describe, expect, it } from "vitest";
import {
  applyPendingBalanceInstruction,
  associatedTokenAccount,
  ConfidentialAccountError,
  confidentialAccountSetupInstructions,
  decryptTokenAccount,
} from "../src/confidential/index.ts";
import {
  confidentialKeysMessage,
  deriveStandardKeys,
  type ConfidentialKeyMaterial,
} from "../src/keys/index.ts";

const MINT = address("AhJfP4JJBaHWRtXRiaScZUC7SMm4RqUPSb3g9H5RT8Bd");

async function keysOf(
  seedText: string,
): Promise<{ wallet: Address; keys: ConfidentialKeyMaterial }> {
  const seed = createHash("sha256").update(seedText).digest();
  const pair = await createKeyPairFromPrivateKeyBytes(new Uint8Array(seed));
  const wallet = await getAddressFromPublicKey(pair.publicKey);
  const signature = new Uint8Array(await signBytes(pair.privateKey, confidentialKeysMessage()));
  return { wallet, keys: await deriveStandardKeys(wallet, signature) };
}

/** A token account whose balances are encrypted to `keys`: available 42, pending 5 in 2 credits. */
function encryptedAccount(owner: Address, keys: ConfidentialKeyMaterial): Token {
  const pubkey = ElGamalPubkey.fromBytes(
    new Uint8Array(getAddressEncoder().encode(keys.elgamalPubkey)),
  );
  const aesKey = AeKey.fromBytes(keys.aeKey);
  try {
    return {
      mint: MINT,
      owner,
      amount: 0n,
      delegate: none(),
      state: AccountState.Initialized,
      isNative: none(),
      delegatedAmount: 0n,
      closeAuthority: none(),
      extensions: some([
        {
          __kind: "ConfidentialTransferAccount",
          approved: true,
          elgamalPubkey: keys.elgamalPubkey,
          pendingBalanceLow: pubkey.encryptU64(5n).toBytes(),
          pendingBalanceHigh: pubkey.encryptU64(0n).toBytes(),
          availableBalance: pubkey.encryptU64(42n).toBytes(),
          decryptableAvailableBalance: aesKey.encrypt(42n).toBytes(),
          allowConfidentialCredits: true,
          allowNonConfidentialCredits: true,
          pendingBalanceCreditCounter: 2n,
          maximumPendingBalanceCreditCounter: 65_536n,
          expectedPendingBalanceCreditCounter: 0n,
          actualPendingBalanceCreditCounter: 0n,
        },
      ]),
    } as Token;
  } finally {
    pubkey.free();
    aesKey.free();
  }
}

describe("confidential account with the keys", () => {
  let owner: { wallet: Address; keys: ConfidentialKeyMaterial };
  let other: { wallet: Address; keys: ConfidentialKeyMaterial };

  beforeAll(async () => {
    owner = await keysOf("sotto-cli-key-check/v1");
    other = await keysOf("sotto-other-wallet/v1");
  });

  it("AC-03.3 builds the setup as one sequence: create, reallocate, configure, proof", async () => {
    const { token, instructions } = await confidentialAccountSetupInstructions({
      owner: createNoopSigner(owner.wallet),
      mint: MINT,
      keys: owner.keys,
    });
    expect(token).toBe(await associatedTokenAccount(owner.wallet, MINT));
    expect(instructions.map((instruction) => instruction.programAddress)).toEqual([
      ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
      TOKEN_2022_PROGRAM_ADDRESS,
      TOKEN_2022_PROGRAM_ADDRESS,
      ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
    ]);
    const signerRoles = new Set([AccountRole.READONLY_SIGNER, AccountRole.WRITABLE_SIGNER]);
    for (const instruction of instructions.slice(0, 3)) {
      expect(
        instruction.accounts.some(
          (account) => account.address === owner.wallet && signerRoles.has(account.role),
        ),
      ).toBe(true);
      expect(instruction.accounts.some((account) => account.address === token)).toBe(true);
    }
    expect(instructions[3]?.accounts ?? []).toEqual([]);
    // The proof carries the owner's ElGamal public key, never a secret.
    const proof = instructions[3]?.data ?? new Uint8Array();
    const pubkey = getAddressEncoder().encode(owner.keys.elgamalPubkey);
    expect(Buffer.from(proof).includes(Buffer.from(pubkey))).toBe(true);
    expect(Buffer.from(proof).includes(Buffer.from(owner.keys.elgamalSecretKey))).toBe(false);
    expect(structuredClone(instructions)).toEqual(instructions);
  });

  it("AC-03.4 decrypts the available and pending balances with the owner's keys", () => {
    const account = encryptedAccount(owner.wallet, owner.keys);
    expect(decryptTokenAccount(account, owner.keys)).toEqual({
      available: 42n,
      pending: 5n,
      pendingBalanceCreditCounter: 2n,
      maximumPendingBalanceCreditCounter: 65_536n,
    });
  });

  it("refuses to decrypt or apply with keys that do not match the account (I-5)", () => {
    const account = encryptedAccount(owner.wallet, owner.keys);
    const mismatch = (run: () => unknown) => {
      const error = (() => {
        try {
          run();
        } catch (caught) {
          return caught;
        }
        return null;
      })();
      expect(error).toBeInstanceOf(ConfidentialAccountError);
      return (error as ConfidentialAccountError).reason;
    };
    expect(mismatch(() => decryptTokenAccount(account, other.keys))).toBe("key_mismatch");
    expect(
      mismatch(() =>
        applyPendingBalanceInstruction({
          token: address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"),
          tokenAccount: account,
          owner: createNoopSigner(owner.wallet),
          keys: other.keys,
        }),
      ),
    ).toBe("key_mismatch");
    expect(
      mismatch(() => decryptTokenAccount({ ...account, extensions: none() }, owner.keys)),
    ).toBe("not_confidential");
  });

  it("AC-04.3 builds the apply instruction from fresh state, signed by the owner", () => {
    const token = address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");
    const instruction = applyPendingBalanceInstruction({
      token,
      tokenAccount: encryptedAccount(owner.wallet, owner.keys),
      owner: createNoopSigner(owner.wallet),
      keys: owner.keys,
    });
    expect(instruction.programAddress).toBe(TOKEN_2022_PROGRAM_ADDRESS);
    expect(instruction.accounts).toEqual([
      { address: token, role: AccountRole.WRITABLE },
      { address: owner.wallet, role: AccountRole.READONLY_SIGNER },
    ]);
  });
});
