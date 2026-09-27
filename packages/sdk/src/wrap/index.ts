// Wrapped USDC through Token Wrap (06 sections 0 and 4; facts C2, C4, C5, C8). The canonical Token Wrap
// program is not deployed; devnet and localnet use the Sotto test deployment, so every PDA and
// instruction here takes the cluster's program address. The client's own createMint,
// createEscrowAccount and singleSignerWrap helpers always use the canonical ID, so their steps are
// repeated here with it.
import { getTransferSolInstruction } from "@solana-program/system";
import {
  extension,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintSize,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";
import {
  findBackpointerPda,
  findWrappedMintAuthorityPda,
  findWrappedMintPda,
  getBackpointerSize,
  getCreateMintInstruction,
  getWrapInstruction,
} from "@solana-program/token-wrap";
import {
  fetchEncodedAccount,
  lamports,
  type Address,
  type GetAccountInfoApi,
  type GetMinimumBalanceForRentExemptionApi,
  type Instruction,
  type Rpc,
  type TransactionSigner,
} from "@solana/kit";

type WrapRpc = Rpc<GetAccountInfoApi & GetMinimumBalanceForRentExemptionApi>;

/**
 * The extensions Token Wrap creates a Token-2022 wrapped mint with, which its client funds the mint
 * for (@solana-program/token-wrap 2.7.1 DEFAULT_EXTENSIONS): confidential transfers with automatic
 * approval, no authority and no auditor (facts C2), and a metadata pointer.
 */
const WRAPPED_MINT_EXTENSIONS = [
  extension("ConfidentialTransferMint", {
    autoApproveNewAccounts: true,
    authority: null,
    auditorElgamalPubkey: null,
  }),
  extension("MetadataPointer", { authority: null, metadataAddress: null }),
];

/** The wrapped Token-2022 mint of an unwrapped mint under a Token Wrap program. */
export async function wrappedMintAddress(
  unwrappedMint: Address,
  programAddress: Address,
): Promise<Address> {
  const [wrappedMint] = await findWrappedMintPda(
    { unwrappedMint, wrappedTokenProgram: TOKEN_2022_PROGRAM_ADDRESS },
    { programAddress },
  );
  return wrappedMint;
}

/**
 * CreateMint is permissionless; the payer funds the wrapped mint and the backpointer to rent exemption
 * first (facts C4). Idempotent, so it can be sent again safely.
 */
export async function createWrappedMintInstructions(input: {
  rpc: WrapRpc;
  payer: TransactionSigner;
  unwrappedMint: Address;
  programAddress: Address;
}): Promise<{ wrappedMint: Address; backpointer: Address; instructions: Instruction[] }> {
  const { rpc, payer, unwrappedMint, programAddress } = input;
  const wrappedMint = await wrappedMintAddress(unwrappedMint, programAddress);
  const [backpointer] = await findBackpointerPda({ wrappedMint }, { programAddress });
  const instructions: Instruction[] = [];
  for (const [account, size] of [
    [wrappedMint, getMintSize(WRAPPED_MINT_EXTENSIONS)],
    [backpointer, getBackpointerSize()],
  ] as const) {
    const [existing, rent] = await Promise.all([
      fetchEncodedAccount(rpc, account),
      rpc.getMinimumBalanceForRentExemption(BigInt(size)).send(),
    ]);
    const held = existing.exists ? existing.lamports : 0n;
    if (held < rent) {
      instructions.push(
        getTransferSolInstruction({
          source: payer,
          destination: account,
          amount: lamports(rent - held),
        }),
      );
    }
  }
  instructions.push(
    getCreateMintInstruction(
      {
        wrappedMint,
        backpointer,
        unwrappedMint,
        wrappedTokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
        idempotent: true,
      },
      { programAddress },
    ),
  );
  return { wrappedMint, backpointer, instructions };
}

/**
 * The escrow that holds unwrapped tokens: the associated token account of the wrapped mint authority
 * (a PDA of the Token Wrap program) for the unwrapped mint, under the unwrapped mint's token program.
 */
export async function createEscrowInstructions(input: {
  rpc: Rpc<GetAccountInfoApi>;
  payer: TransactionSigner;
  unwrappedMint: Address;
  programAddress: Address;
}): Promise<{ escrow: Address; instructions: Instruction[] }> {
  const { rpc, payer, unwrappedMint, programAddress } = input;
  const wrappedMint = await wrappedMintAddress(unwrappedMint, programAddress);
  const [authority] = await findWrappedMintAuthorityPda({ wrappedMint }, { programAddress });
  const mintAccount = await fetchEncodedAccount(rpc, unwrappedMint);
  if (!mintAccount.exists) throw new Error(`the unwrapped mint ${unwrappedMint} does not exist`);
  const tokenProgram = mintAccount.programAddress;
  const [escrow] = await findAssociatedTokenPda({
    owner: authority,
    mint: unwrappedMint,
    tokenProgram,
  });
  return {
    escrow,
    instructions: [
      getCreateAssociatedTokenIdempotentInstruction({
        payer,
        ata: escrow,
        owner: authority,
        mint: unwrappedMint,
        tokenProgram,
      }),
    ],
  };
}

/**
 * 06 section 4, step 1 (AC-04.1): Token Wrap `Wrap` from the owner's associated unwrapped token
 * account into the owner's associated wrapped account, a public balance. The wrapped account is
 * created first if missing (idempotent, the owner pays); the owner signs as transfer authority. The
 * escrow must exist (the bootstrap creates it on localnet; facts C8 for devnet).
 */
export async function wrapInstructions(input: {
  owner: TransactionSigner;
  unwrappedMint: Address;
  /** The unwrapped mint's token program: SPL Token for USDC. */
  unwrappedTokenProgram: Address;
  programAddress: Address;
  amount: bigint;
}): Promise<{
  wrappedMint: Address;
  unwrappedTokenAccount: Address;
  wrappedTokenAccount: Address;
  escrow: Address;
  instructions: Instruction[];
}> {
  const { owner, unwrappedMint, unwrappedTokenProgram, programAddress, amount } = input;
  if (amount <= 0n) throw new Error("the wrap amount must be more than zero");
  const wrappedMint = await wrappedMintAddress(unwrappedMint, programAddress);
  const [wrappedMintAuthority] = await findWrappedMintAuthorityPda(
    { wrappedMint },
    { programAddress },
  );
  const [[unwrappedTokenAccount], [wrappedTokenAccount], [escrow]] = await Promise.all([
    findAssociatedTokenPda({
      owner: owner.address,
      mint: unwrappedMint,
      tokenProgram: unwrappedTokenProgram,
    }),
    findAssociatedTokenPda({
      owner: owner.address,
      mint: wrappedMint,
      tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
    }),
    findAssociatedTokenPda({
      owner: wrappedMintAuthority,
      mint: unwrappedMint,
      tokenProgram: unwrappedTokenProgram,
    }),
  ]);
  return {
    wrappedMint,
    unwrappedTokenAccount,
    wrappedTokenAccount,
    escrow,
    instructions: [
      getCreateAssociatedTokenIdempotentInstruction({
        payer: owner,
        ata: wrappedTokenAccount,
        owner: owner.address,
        mint: wrappedMint,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      }),
      getWrapInstruction(
        {
          recipientWrappedTokenAccount: wrappedTokenAccount,
          wrappedMint,
          wrappedMintAuthority,
          unwrappedTokenProgram,
          wrappedTokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
          unwrappedTokenAccount,
          unwrappedMint,
          unwrappedEscrow: escrow,
          transferAuthority: owner,
          amount,
        },
        { programAddress },
      ),
    ],
  };
}
