// One real proof of funds on devnet against the deployed sotto_proofs (step 2.7, founder): a throwaway
// keypair owner (~/.config/solana/sotto/proof-of-funds-devnet-owner.json, mode 600, holding only a
// little devnet SOL and 1 devnet USDC from wallet A) sets up its confidential wUSDC account with the
// standard_v1 keys of its own signature, wraps and deposits 1 USDC and applies it, proves "at least
// 0.5 wUSDC" with the token-2022 withdraw proof builder (06 section 8), calls verify_balance_threshold,
// reads the record and the event back, and closes the two context accounts, their rent to the owner.
// Every step reads the chain first, so a stopped run resumes. Every transaction is simulated before it
// is signed (06 section 9). It prints the signatures; no key or secret is printed.
//
// Usage: node scripts/proof-of-funds-devnet.ts
import { existsSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { getClusterConfig, type AvailableClusterConfig } from "@sotto/sdk/cluster";
import {
  applyPendingBalanceInstruction,
  confidentialAccountSetupInstructions,
  decryptTokenAccount,
} from "@sotto/sdk/confidential";
import {
  associatedTokenAccount,
  closeProofAccounts,
  decodeToken2022Account,
  wrapAndDepositTransactions,
} from "@sotto/sdk/confidential/public";
import { confidentialKeysMessage, deriveStandardKeys } from "@sotto/sdk/keys";
import {
  balanceThresholdProofs,
  counterpartyHash,
  fetchProofRecord,
  findProofRecordPda,
  getVerifyBalanceThresholdInstructionAsync,
  proofVerifiedEvent,
  randomBytes16,
  recordNonce,
} from "@sotto/sdk/proofs";
import { keypairWallet } from "@sotto/sdk/testing";
import {
  fromPortableInstruction,
  sendWithKeypairSigners,
  sendWithWallet,
  simulateInstructions,
} from "@sotto/sdk/tx";
import {
  createNoopSigner,
  fetchEncodedAccount,
  lamports,
  signBytes,
  type Address,
  type KeyPairSigner,
  type SignatureBytes,
  type Transaction,
} from "@solana/kit";
import { devnetRpc, sottoKeypair } from "./devnet.ts";

const USDC = 1_000_000n;
const THRESHOLD = USDC / 2n;
const OWNER_FILE = "proof-of-funds-devnet-owner.json";
const OWNER_SOL = 50_000_000n;

const cluster = getClusterConfig("devnet") as AvailableClusterConfig;
if (!cluster.sottoProofs || !cluster.usdcMint || !cluster.wrappedUsdcMint) {
  throw new Error("no devnet sotto_proofs, USDC or wrapped mint in the cluster config");
}
const programAddress = cluster.sottoProofs.program;
const usdcMint = cluster.usdcMint;
const wrappedMint = cluster.wrappedUsdcMint;
const rpc = await devnetRpc();
const walletA = await sottoKeypair("wallet-a.json");
const signatures: Record<string, string> = {};

// The throwaway owner, created once.
const ownerPath = join(homedir(), ".config", "solana", "sotto", OWNER_FILE);
if (!existsSync(ownerPath)) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const bytes = [
    ...privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32),
    ...publicKey.export({ format: "der", type: "spki" }).subarray(-32),
  ];
  writeFileSync(ownerPath, JSON.stringify(bytes), { mode: 0o600 });
}
const owner = await sottoKeypair(OWNER_FILE);
const wallet = keypairWallet(owner);
const keys = await deriveStandardKeys(
  owner.address,
  new Uint8Array(await signBytes(owner.keyPair.privateKey, confidentialKeysMessage())),
);
const ownerUsdc = await associatedTokenAccount(owner.address, usdcMint, TOKEN_PROGRAM_ADDRESS);
const wusdc = await associatedTokenAccount(owner.address, wrappedMint);
console.log(`owner:             ${owner.address}`);
console.log(`owner wUSDC:       ${wusdc}`);

/** The plan's accounts sign the transactions that need them, over the message the owner signed. */
function cosigner(signers: readonly KeyPairSigner[]) {
  return async (transaction: Transaction): Promise<Record<Address, SignatureBytes>> => {
    const out: Record<Address, SignatureBytes> = {};
    for (const signer of signers) {
      if (!(signer.address in transaction.signatures)) continue;
      const [dictionary] = await signer.signTransactions([
        transaction as Parameters<KeyPairSigner["signTransactions"]>[0][number],
      ]);
      const signature = dictionary?.[signer.address];
      if (signature) out[signer.address] = signature;
    }
    return out;
  };
}

const exists = async (account: Address) =>
  (await fetchEncodedAccount(rpc, account, { commitment: "confirmed" })).exists;
const tokenAmount = async (account: Address) =>
  (await exists(account))
    ? BigInt(
        (await rpc.getTokenAccountBalance(account, { commitment: "confirmed" }).send()).value
          .amount,
      )
    : 0n;
const tokenState = async () => {
  const account = await fetchEncodedAccount(rpc, wusdc, { commitment: "confirmed" });
  return account.exists ? decodeToken2022Account(new Uint8Array(account.data)) : null;
};
const available = async () => {
  const state = await tokenState();
  return state ? decryptTokenAccount(state, keys) : { available: 0n, pending: 0n };
};

// 1. SOL and 1 USDC from wallet A, once.
const sol = (await rpc.getBalance(owner.address, { commitment: "confirmed" }).send()).value;
if (sol < OWNER_SOL / 2n) {
  const sent = await sendWithKeypairSigners({
    rpc,
    feePayer: walletA,
    instructions: [
      getTransferSolInstruction({
        source: walletA,
        destination: owner.address,
        amount: lamports(OWNER_SOL),
      }),
    ],
  });
  signatures.fundSol = sent.signature;
}
const balances = await available();
if (balances.available + balances.pending < THRESHOLD && (await tokenAmount(ownerUsdc)) < USDC) {
  const [sourceUsdc] = await findAssociatedTokenPda({
    owner: walletA.address,
    mint: usdcMint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });
  const sent = await sendWithKeypairSigners({
    rpc,
    feePayer: walletA,
    instructions: [
      getCreateAssociatedTokenIdempotentInstruction({
        payer: walletA,
        ata: ownerUsdc,
        owner: owner.address,
        mint: usdcMint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      }),
      getTransferCheckedInstruction({
        source: sourceUsdc,
        mint: usdcMint,
        destination: ownerUsdc,
        authority: walletA,
        amount: USDC,
        decimals: 6,
      }),
    ],
  });
  signatures.fundUsdc = sent.signature;
}

// 2. The confidential wUSDC account (06 section 3).
if (!(await exists(wusdc))) {
  const setup = await confidentialAccountSetupInstructions({
    owner: createNoopSigner(owner.address),
    mint: wrappedMint,
    keys,
  });
  signatures.accountSetup = (
    await sendWithWallet({ rpc, wallet, version: 0, instructions: setup.instructions })
  ).signature;
}

// 3. Wrap and deposit 1 USDC, then apply (06 section 4).
if ((await available()).available + (await available()).pending < THRESHOLD) {
  const plan = await wrapAndDepositTransactions({
    owner: createNoopSigner(owner.address),
    unwrappedMint: usdcMint,
    unwrappedTokenProgram: TOKEN_PROGRAM_ADDRESS,
    programAddress: cluster.programs.tokenWrap,
    amount: USDC,
    decimals: 6,
    version: 0,
  });
  let index = 0;
  for (const instructions of plan.transactions) {
    signatures[`wrapDeposit${index++}`] = (
      await sendWithWallet({ rpc, wallet, version: 0, instructions })
    ).signature;
  }
}
if ((await available()).pending > 0n) {
  const fresh = await tokenState();
  if (!fresh) throw new Error("the wUSDC account is missing");
  signatures.applyPending = (
    await sendWithWallet({
      rpc,
      wallet,
      version: 0,
      instructions: [
        applyPendingBalanceInstruction({
          token: wusdc,
          tokenAccount: fresh,
          owner: createNoopSigner(owner.address),
          keys,
        }),
      ],
    })
  ).signature;
}
const before = await available();
console.log(`available:         ${before.available} base units`);

// 4. The proofs of "at least 0.5 wUSDC" into two context accounts (06 section 8).
const proofs = await balanceThresholdProofs({
  owner: owner.address,
  token: wusdc,
  tokenAccount:
    (await tokenState()) ??
    (() => {
      throw new Error("the wUSDC account is missing");
    })(),
  mint: wrappedMint,
  decimals: 6,
  threshold: THRESHOLD,
  keys,
  rent: (space) => rpc.getMinimumBalanceForRentExemption(space).send(),
});
const cosign = cosigner(proofs.signers);
let proofIndex = 0;
for (const transaction of proofs.transactions) {
  signatures[`proof${proofIndex++}`] = (
    await sendWithWallet({
      rpc,
      wallet,
      version: 0,
      instructions: transaction.instructions.map(fromPortableInstruction),
      cosign,
    })
  ).signature;
}
console.log(`equality context:  ${proofs.equalityContext}`);
console.log(`range context:     ${proofs.rangeContext}`);

// 5. verify_balance_threshold.
const slot = await rpc.getSlot({ commitment: "confirmed" }).send();
const now = BigInt((await rpc.getBlockTime(slot).send()) ?? 0n);
const nonce = await recordNonce(wusdc, programAddress);
const expiry = now + 7n * 24n * 3600n;
const verify = await getVerifyBalanceThresholdInstructionAsync(
  {
    owner,
    tokenAccount: wusdc,
    equalityContext: proofs.equalityContext,
    rangeContext: proofs.rangeContext,
    payer: owner,
    threshold: THRESHOLD,
    nonce,
    expiry,
    counterpartyHash: await counterpartyHash(randomBytes16(), "Sotto devnet check"),
  },
  { programAddress },
);
const simulated = await simulateInstructions({
  rpc,
  feePayer: owner.address,
  instructions: [verify],
});
if (simulated.err !== null)
  throw new Error(`verify simulation failed: ${JSON.stringify(simulated)}`);
const units = simulated.logs
  .map((line) => new RegExp(`Program ${programAddress} consumed (\\d+) of`).exec(line)?.[1])
  .find(Boolean);
const tokenLamports = (await rpc.getBalance(wusdc, { commitment: "confirmed" }).send()).value;
const verified = await sendWithWallet({ rpc, wallet, version: 0, instructions: [verify] });
signatures.verifyBalanceThreshold = verified.signature;
const landed = await rpc
  .getTransaction(verified.signature as Parameters<typeof rpc.getTransaction>[0], {
    commitment: "confirmed",
    encoding: "json",
    maxSupportedTransactionVersion: 1,
  })
  .send();
const [record] = await findProofRecordPda({ tokenAccount: wusdc, nonce }, { programAddress });
const stored = await fetchProofRecord(rpc, record, { commitment: "confirmed" });
const event = proofVerifiedEvent(landed?.meta?.logMessages ?? []);
console.log(`verify units:      ${units} (simulated)`);
console.log(`record:            ${record}`);
console.log(
  `record data:       threshold ${stored.data.threshold}, slot ${stored.data.slot}, expiry ${stored.data.expiry}, owner ${stored.data.owner}`,
);
console.log(
  `event:             ${event ? "ProofVerified" : "missing"} for record ${event?.record}`,
);
if (!event || event.record !== record || stored.data.threshold !== THRESHOLD) {
  throw new Error("the record or the event is not the one expected");
}

// 6. The context accounts closed, their rent to the owner; the token account's lamports unchanged.
const closed = await closeProofAccounts({
  rpc,
  wallet,
  version: 0,
  cleanup: proofs.cleanup,
  cosign,
});
closed.signatures.forEach((signature, index) => (signatures[`closeContexts${index}`] = signature));
const remaining = await Promise.all([proofs.equalityContext, proofs.rangeContext].map(exists));
const tokenLamportsAfter = (await rpc.getBalance(wusdc, { commitment: "confirmed" }).send()).value;
console.log(`contexts open:     ${remaining.filter(Boolean).length}`);
console.log(`token lamports:    ${tokenLamports} before, ${tokenLamportsAfter} after`);
console.log(JSON.stringify(signatures, null, 2));
if (remaining.some(Boolean) || tokenLamports !== tokenLamportsAfter) {
  throw new Error("a context is still open or the token account's lamports changed");
}
console.log("PROOF OF FUNDS OK");
