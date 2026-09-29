// Localnet helpers for tests (the SDK, worker and E2E localnet tests): the bootstrap record of
// scripts/bootstrap-localnet.ts, wallets funded with localnet SOL and the local USDC-like mint (the
// bootstrap payer is its mint authority), and the owner steps of 06 sections 3 to 6 signed through the
// wallet path (since step 2.5 a transfer, and a withdrawal with its unwrap). Localnet only: the
// bootstrap refuses devnet and mainnet.
import { readFileSync } from "node:fs";
import {
  getCreateAssociatedTokenIdempotentInstruction,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  fetchMint,
  fetchToken,
  getDisableConfidentialCreditsInstruction,
  getEnableConfidentialCreditsInstruction,
} from "@solana-program/token-2022";
import {
  createKeyPairSignerFromBytes,
  createNoopSigner,
  generateKeyPairSigner,
  lamports,
  signBytes,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Signature,
  type SignatureBytes,
  type Transaction,
  type TransactionModifyingSigner,
} from "@solana/kit";
import { getClusterConfig, type AvailableClusterConfig } from "../cluster/config.ts";
import {
  applyPendingBalanceInstruction,
  confidentialAccountSetupInstructions,
} from "../confidential/account.ts";
import { wrapAndDepositTransactions } from "../confidential/funding.ts";
import { confidentialTransferPlan, confidentialWithdrawPlan } from "../confidential/transfer.ts";
import { sendTransferTransactions } from "../confidential/transfer-send.ts";
import { associatedTokenAccount, confidentialDepositInstruction } from "../confidential/state.ts";
import { confidentialKeysMessage } from "../keys/messages.ts";
import { deriveStandardKeys, type ConfidentialKeyMaterial } from "../keys/confidential.ts";
import type { SolanaRpc } from "../tx/rpc.ts";
import { sendWithKeypairSigners, waitForConfirmation } from "../tx/send-keypair.ts";
import { sendWithWallet } from "../tx/send-wallet.ts";
import { unwrapInstructions, wrapInstructions } from "../wrap/index.ts";
import { keypairWallet } from "./index.ts";

export type LocalnetBootstrap = {
  rpcUrl: string;
  payer: { address: Address; keypair: string };
  usdcMint: Address;
  usdcDecimals: number;
  wrappedUsdcMint: Address;
  escrow: Address;
  /** The throwaway SAS signer (funded) and its credential and schema (scripts/bootstrap-localnet.ts). */
  sas: { signer: Address; signerKeypair: string; credential: Address; schema: Address };
  /** sotto_proofs under a throwaway program keypair, the payer its upgrade authority (step 2.7); null
   * when it was not built before the bootstrap. */
  sottoProofs: { programId: Address; config: Address; programKeypair: string } | null;
};

const DEFAULT_BOOTSTRAP = new URL("../../../../.localnet/bootstrap.json", import.meta.url);

export function readLocalnetBootstrap(path: string | URL = DEFAULT_BOOTSTRAP): LocalnetBootstrap {
  return JSON.parse(readFileSync(path, "utf8")) as LocalnetBootstrap;
}

async function mintAuthority(bootstrap: LocalnetBootstrap): Promise<KeyPairSigner> {
  const bytes = JSON.parse(readFileSync(bootstrap.payer.keypair, "utf8")) as number[];
  return createKeyPairSignerFromBytes(new Uint8Array(bytes));
}

/** Airdrops SOL to a wallet and mints it whole USDC into its associated USDC account. */
export async function fundLocalnetWallet(
  rpc: SolanaRpc,
  bootstrap: LocalnetBootstrap,
  wallet: Address,
  amounts: { sol: bigint; usdc: bigint },
): Promise<{ usdc: Address }> {
  if (amounts.sol > 0n) {
    await waitForConfirmation(
      rpc,
      await rpc.requestAirdrop(wallet, lamports(amounts.sol * 1_000_000_000n)).send(),
    );
  }
  const usdc = await associatedTokenAccount(wallet, bootstrap.usdcMint, TOKEN_PROGRAM_ADDRESS);
  const authority = await mintAuthority(bootstrap);
  await sendWithKeypairSigners({
    rpc,
    feePayer: authority,
    instructions: [
      getCreateAssociatedTokenIdempotentInstruction({
        payer: authority,
        ata: usdc,
        owner: wallet,
        mint: bootstrap.usdcMint,
      }),
      ...(amounts.usdc > 0n
        ? [
            getMintToInstruction({
              mint: bootstrap.usdcMint,
              token: usdc,
              mintAuthority: authority,
              amount: amounts.usdc * 10n ** BigInt(bootstrap.usdcDecimals),
            }),
          ]
        : []),
    ],
  });
  return { usdc };
}

export type LocalnetOwner = {
  signer: KeyPairSigner;
  wallet: TransactionModifyingSigner;
  keys: ConfidentialKeyMaterial;
  usdc: Address;
  wusdc: Address;
};

/** A new owner wallet with 10 SOL, `usdc` whole USDC and the standard_v1 keys of its signature. */
export async function newLocalnetOwner(
  rpc: SolanaRpc,
  bootstrap: LocalnetBootstrap,
  usdc: bigint,
): Promise<LocalnetOwner> {
  const signer = await generateKeyPairSigner();
  const funded = await fundLocalnetWallet(rpc, bootstrap, signer.address, { sol: 10n, usdc });
  const signature = new Uint8Array(
    await signBytes(signer.keyPair.privateKey, confidentialKeysMessage()),
  );
  return {
    signer,
    wallet: keypairWallet(signer),
    keys: await deriveStandardKeys(signer.address, signature),
    usdc: funded.usdc,
    wusdc: await associatedTokenAccount(signer.address, bootstrap.wrappedUsdcMint),
  };
}

const localnet = () => getClusterConfig("localnet") as AvailableClusterConfig;

export function sendAsOwner(
  rpc: SolanaRpc,
  owner: LocalnetOwner,
  instructions: readonly Instruction[],
  version: 0 | 1 = 0,
) {
  return sendWithWallet({ rpc, wallet: owner.wallet, instructions, version });
}

/** 06 section 3: creates and configures the owner's wUSDC account (one v1 transaction). */
export async function setUpLocalnetAccount(
  rpc: SolanaRpc,
  owner: LocalnetOwner,
  bootstrap: LocalnetBootstrap,
  maximumPendingBalanceCreditCounter?: bigint,
) {
  const setup = await confidentialAccountSetupInstructions({
    owner: createNoopSigner(owner.signer.address),
    mint: bootstrap.wrappedUsdcMint,
    keys: owner.keys,
    ...(maximumPendingBalanceCreditCounter === undefined
      ? {}
      : { maximumPendingBalanceCreditCounter }),
  });
  return sendAsOwner(rpc, owner, setup.instructions, 1);
}

/** 06 section 4, step 1: wraps base units of USDC into the owner's public wUSDC. */
export async function wrapLocalnetUsdc(
  rpc: SolanaRpc,
  owner: LocalnetOwner,
  bootstrap: LocalnetBootstrap,
  amount: bigint,
  version: 0 | 1 = 0,
) {
  const built = await wrapInstructions({
    owner: createNoopSigner(owner.signer.address),
    unwrappedMint: bootstrap.usdcMint,
    unwrappedTokenProgram: TOKEN_PROGRAM_ADDRESS,
    programAddress: localnet().programs.tokenWrap,
    amount,
  });
  return { built, sent: await sendAsOwner(rpc, owner, built.instructions, version) };
}

/**
 * Wraps base units of USDC into public wUSDC for a keypair outside Sotto, as tokens received publicly
 * would be; creates the wUSDC account without the confidential extension if it is missing.
 */
export async function wrapLocalnetUsdcAs(
  rpc: SolanaRpc,
  bootstrap: LocalnetBootstrap,
  signer: KeyPairSigner,
  amount: bigint,
) {
  const built = await wrapInstructions({
    owner: signer,
    unwrappedMint: bootstrap.usdcMint,
    unwrappedTokenProgram: TOKEN_PROGRAM_ADDRESS,
    programAddress: localnet().programs.tokenWrap,
    amount,
  });
  return sendWithKeypairSigners({ rpc, feePayer: signer, instructions: built.instructions });
}

/**
 * 06 section 4, steps 1 and 2 in one signature when they fit (step 1.7.1): wraps base units of USDC and
 * deposits them into the pending balance; returns the plan and every transaction sent.
 */
export async function fundLocalnetAccount(
  rpc: SolanaRpc,
  owner: LocalnetOwner,
  bootstrap: LocalnetBootstrap,
  amount: bigint,
  version: 0 | 1 = 0,
) {
  const plan = await wrapAndDepositTransactions({
    owner: createNoopSigner(owner.signer.address),
    unwrappedMint: bootstrap.usdcMint,
    unwrappedTokenProgram: TOKEN_PROGRAM_ADDRESS,
    programAddress: localnet().programs.tokenWrap,
    amount,
    decimals: bootstrap.usdcDecimals,
    version,
  });
  const sent = [];
  for (const instructions of plan.transactions) {
    sent.push(await sendAsOwner(rpc, owner, instructions, version));
  }
  return { plan, sent };
}

/** 06 section 4, step 2: the deposit instruction for base units of the owner's public wUSDC. */
export function localnetDeposit(
  owner: LocalnetOwner,
  bootstrap: LocalnetBootstrap,
  amount: bigint,
) {
  return confidentialDepositInstruction({
    token: owner.wusdc,
    mint: bootstrap.wrappedUsdcMint,
    owner: createNoopSigner(owner.signer.address),
    amount,
    decimals: bootstrap.usdcDecimals,
  });
}

/** 06 section 4, step 3: applies the pending balance from fresh account state. */
export async function applyLocalnetPending(rpc: SolanaRpc, owner: LocalnetOwner) {
  const fresh = await fetchToken(rpc, owner.wusdc, { commitment: "confirmed" });
  return sendAsOwner(rpc, owner, [
    applyPendingBalanceInstruction({
      token: owner.wusdc,
      tokenAccount: fresh.data,
      owner: createNoopSigner(owner.signer.address),
      keys: owner.keys,
    }),
  ]);
}

/**
 * The owner turns confidential credits of their wUSDC account off or on (step 2.3): a transfer to an
 * account with credits off fails, which the payroll tests use to fail a chosen line.
 */
export function setLocalnetConfidentialCredits(rpc: SolanaRpc, owner: LocalnetOwner, on: boolean) {
  const instruction = (
    on ? getEnableConfidentialCreditsInstruction : getDisableConfidentialCreditsInstruction
  )({ token: owner.wusdc, authority: createNoopSigner(owner.signer.address) });
  return sendAsOwner(rpc, owner, [instruction]);
}

/** A plan's own accounts sign the transactions that need them, over the message the wallet signed. */
export function planCosigner(signers: readonly KeyPairSigner[]) {
  return async (transaction: Transaction): Promise<Record<Address, SignatureBytes>> => {
    const signatures: Record<Address, SignatureBytes> = {};
    for (const signer of signers) {
      if (!(signer.address in transaction.signatures)) continue;
      const [dictionary] = await signer.signTransactions([
        transaction as Parameters<KeyPairSigner["signTransactions"]>[0][number],
      ]);
      const signature = dictionary?.[signer.address];
      if (signature) signatures[signer.address] = signature;
    }
    return signatures;
  };
}

/**
 * 06 section 5 (step 2.5): a confidential transfer between two localnet owners' wUSDC accounts, built
 * from their state on chain now; returns the signature of its transfer transaction.
 */
export async function transferOnLocalnet(
  rpc: SolanaRpc,
  bootstrap: LocalnetBootstrap,
  sender: LocalnetOwner,
  recipient: LocalnetOwner,
  amount: bigint,
  version: 0 | 1 = 0,
): Promise<Signature> {
  const [source, destination, mint] = await Promise.all([
    fetchToken(rpc, sender.wusdc, { commitment: "confirmed" }),
    fetchToken(rpc, recipient.wusdc, { commitment: "confirmed" }),
    fetchMint(rpc, bootstrap.wrappedUsdcMint, { commitment: "confirmed" }),
  ]);
  const plan = await confidentialTransferPlan({
    owner: sender.signer.address,
    sourceToken: sender.wusdc,
    sourceTokenAccount: source.data,
    destinationToken: recipient.wusdc,
    destinationTokenAccount: destination.data,
    mint: bootstrap.wrappedUsdcMint,
    mintAccount: mint.data,
    amount,
    keys: sender.keys,
    version,
    rent: (space) => rpc.getMinimumBalanceForRentExemption(space).send(),
  });
  const sent = await sendTransferTransactions({
    rpc,
    wallet: sender.wallet,
    version,
    transactions: plan.transactions,
    cosign: planCosigner(plan.signers),
  });
  return sent.transferSignature as Signature;
}

/**
 * 06 section 6 (step 2.5): withdraws base units from the available balance to public wUSDC, then
 * unwraps them to USDC; returns the unwrap's signature.
 */
export async function withdrawAndUnwrapOnLocalnet(
  rpc: SolanaRpc,
  bootstrap: LocalnetBootstrap,
  owner: LocalnetOwner,
  amount: bigint,
  version: 0 | 1 = 0,
): Promise<Signature> {
  const token = await fetchToken(rpc, owner.wusdc, { commitment: "confirmed" });
  const plan = await confidentialWithdrawPlan({
    owner: owner.signer.address,
    token: owner.wusdc,
    tokenAccount: token.data,
    mint: bootstrap.wrappedUsdcMint,
    decimals: bootstrap.usdcDecimals,
    amount,
    keys: owner.keys,
    version,
    rent: (space) => rpc.getMinimumBalanceForRentExemption(space).send(),
  });
  await sendTransferTransactions({
    rpc,
    wallet: owner.wallet,
    version,
    transactions: plan.transactions,
    cosign: planCosigner(plan.signers),
  });
  const unwrap = await unwrapInstructions({
    owner: createNoopSigner(owner.signer.address),
    unwrappedMint: bootstrap.usdcMint,
    unwrappedTokenProgram: TOKEN_PROGRAM_ADDRESS,
    programAddress: localnet().programs.tokenWrap,
    amount,
  });
  return (await sendAsOwner(rpc, owner, unwrap.instructions, version)).signature;
}
