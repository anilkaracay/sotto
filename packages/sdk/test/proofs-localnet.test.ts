// sotto_proofs on localnet (step 2.7, docs/05-ONCHAIN-PROGRAM.md section 7, 06 section 8), with the
// program the bootstrap deployed (scripts/bootstrap-localnet.ts): an owner with 10 wUSDC available
// proves "at least 7 wUSDC" with real proofs made by `@solana/zk-sdk` through the token-2022 withdraw
// proof builder, verified into two context accounts owned by the owner; `verify_balance_threshold`
// writes the record and the ProofVerified event, and the Codama client reads the record back; another
// threshold and a balance that changed after the proofs are refused with CiphertextMismatch; the
// context accounts are closed with their rent to the fee payer and the token account's lamports are
// unchanged (11 section 5 item 7); the record closes after its expiry (X-31). Skipped unless
// SOTTO_LOCALNET_RPC_URL is set (the ci:local localnet job runs it).
import { fetchToken } from "@solana-program/token-2022";
import {
  fetchEncodedAccount,
  fetchEncodedAccounts,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type SignatureBytes,
  type Transaction,
} from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { closeProofAccounts } from "../src/confidential/index.ts";
import { balanceThresholdProofs, type BalanceThresholdProofs } from "../src/proofs/plan.ts";
import {
  counterpartyHash,
  fetchProofRecord,
  findProofRecordPda,
  getCloseProofRecordInstruction,
  getVerifyBalanceThresholdInstructionAsync,
  proofVerifiedEvent,
  randomBytes16,
  recordNonce,
  SOTTO_PROOFS_ERROR__CIPHERTEXT_MISMATCH,
  VERIFY_BALANCE_THRESHOLD_COMPUTE_UNITS,
} from "../src/proofs/index.ts";
import {
  applyLocalnetPending,
  fundLocalnetAccount,
  newLocalnetOwner,
  readLocalnetBootstrap,
  setUpLocalnetAccount,
  type LocalnetBootstrap,
  type LocalnetOwner,
} from "../src/testing/localnet.ts";
import {
  createRetryingRpc,
  sendWithWallet,
  simulateInstructions,
  fromPortableInstruction,
  type SolanaRpc,
} from "../src/tx/index.ts";

const RPC_URL = process.env.SOTTO_LOCALNET_RPC_URL;
const USDC = 1_000_000n;
const THRESHOLD = 7n * USDC;

/** The plan's accounts sign the transactions that need them, over the message the wallet signed. */
function cosigner(signers: readonly KeyPairSigner[]) {
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

/** The custom program error of a failed simulation, if any. */
function customError(err: unknown): number | null {
  const failure = (err as { InstructionError?: [number, { Custom?: number | bigint }] } | null)
    ?.InstructionError;
  const code = failure?.[1]?.Custom;
  return code === undefined ? null : Number(code);
}

describe.skipIf(!RPC_URL)("sotto_proofs on localnet (step 2.7)", () => {
  let rpc: SolanaRpc;
  let bootstrap: LocalnetBootstrap;
  let programAddress: Address;
  let owner: LocalnetOwner;

  beforeAll(async () => {
    rpc = createRetryingRpc(RPC_URL as string);
    bootstrap = readLocalnetBootstrap();
    if (!bootstrap.sottoProofs) {
      throw new Error(
        "sotto_proofs is not deployed: build it with cargo-build-sbf --arch v3, bootstrap again",
      );
    }
    programAddress = bootstrap.sottoProofs.programId;
    owner = await newLocalnetOwner(rpc, bootstrap, 20n);
    await setUpLocalnetAccount(rpc, owner, bootstrap);
    await fundLocalnetAccount(rpc, owner, bootstrap, 10n * USDC);
    await applyLocalnetPending(rpc, owner);
  }, 180_000);

  const tokenAccount = () => fetchToken(rpc, owner.wusdc as Address, { commitment: "confirmed" });

  async function prove(threshold: bigint): Promise<BalanceThresholdProofs> {
    const proofs = await balanceThresholdProofs({
      owner: owner.signer.address,
      token: owner.wusdc as Address,
      tokenAccount: (await tokenAccount()).data,
      mint: bootstrap.wrappedUsdcMint,
      decimals: bootstrap.usdcDecimals,
      threshold,
      keys: owner.keys,
      rent: (space) => rpc.getMinimumBalanceForRentExemption(space).send(),
    });
    const cosign = cosigner(proofs.signers);
    for (const transaction of proofs.transactions) {
      await sendWithWallet({
        rpc,
        wallet: owner.wallet,
        version: 0,
        instructions: transaction.instructions.map(fromPortableInstruction),
        cosign,
      });
    }
    return proofs;
  }

  async function verifyInstruction(
    proofs: BalanceThresholdProofs,
    threshold: bigint,
    expiry: bigint,
    nonce?: Uint8Array,
  ): Promise<Instruction> {
    return getVerifyBalanceThresholdInstructionAsync(
      {
        owner: owner.signer,
        tokenAccount: owner.wusdc as Address,
        equalityContext: proofs.equalityContext,
        rangeContext: proofs.rangeContext,
        payer: owner.signer,
        threshold,
        nonce: nonce ?? (await recordNonce(owner.wusdc as Address, programAddress)),
        expiry,
        counterpartyHash: await counterpartyHash(randomBytes16(), "Harbor Bank"),
      },
      { programAddress },
    );
  }

  /** The chain's unix time, which the program checks the expiry against. */
  const now = async (): Promise<bigint> => {
    const slot = await rpc.getSlot({ commitment: "confirmed" }).send();
    return BigInt((await rpc.getBlockTime(slot).send()) ?? 0n);
  };

  async function closeContexts(proofs: BalanceThresholdProofs): Promise<void> {
    await closeProofAccounts({
      rpc,
      wallet: owner.wallet,
      version: 0,
      cleanup: proofs.cleanup,
      cosign: cosigner(proofs.signers),
    });
  }

  it("verifies real @solana/zk-sdk proofs of at least 7 of 10 wUSDC and writes the record", async () => {
    const tokenLamportsBefore = (await fetchEncodedAccount(rpc, owner.wusdc as Address)).exists
      ? (await rpc.getBalance(owner.wusdc as Address, { commitment: "confirmed" }).send()).value
      : 0n;
    const proofs = await prove(THRESHOLD);
    expect(proofs.availableBefore).toBe(10n * USDC);
    const nonce = await recordNonce(owner.wusdc as Address, programAddress);
    const expiry = (await now()) + 30n * 24n * 3600n;
    const instruction = await verifyInstruction(proofs, THRESHOLD, expiry, nonce);

    // Another threshold with the same proofs: the onchain subtraction no longer matches.
    const wrong = await simulateInstructions({
      rpc,
      feePayer: owner.signer.address,
      instructions: [await verifyInstruction(proofs, THRESHOLD + 1n, expiry)],
    });
    expect(customError(wrong.err)).toBe(SOTTO_PROOFS_ERROR__CIPHERTEXT_MISMATCH);

    const simulated = await simulateInstructions({
      rpc,
      feePayer: owner.signer.address,
      instructions: [instruction],
    });
    expect(simulated.err).toBeNull();
    const units = simulated.logs
      .map((line) => new RegExp(`Program ${programAddress} consumed (\\d+) of`).exec(line)?.[1])
      .find(Boolean);
    console.log(`verify_balance_threshold on localnet: ${units} compute units`);
    expect(Number(units)).toBeLessThanOrEqual(
      Math.floor(VERIFY_BALANCE_THRESHOLD_COMPUTE_UNITS / 1.2),
    );

    const sent = await sendWithWallet({
      rpc,
      wallet: owner.wallet,
      version: 1,
      instructions: [instruction],
    });
    const landed = await rpc
      .getTransaction(sent.signature as Parameters<typeof rpc.getTransaction>[0], {
        commitment: "confirmed",
        encoding: "json",
        maxSupportedTransactionVersion: 1,
      })
      .send();
    const [record] = await findProofRecordPda(
      { tokenAccount: owner.wusdc as Address, nonce },
      { programAddress },
    );
    const event = proofVerifiedEvent(landed?.meta?.logMessages ?? []);
    expect(event).toMatchObject({
      record,
      tokenAccount: owner.wusdc,
      owner: owner.signer.address,
      threshold: THRESHOLD,
      expiry,
    });
    const stored = await fetchProofRecord(rpc, record, { commitment: "confirmed" });
    expect(stored.programAddress).toBe(programAddress);
    expect(stored.data).toMatchObject({
      version: 1,
      tokenAccount: owner.wusdc,
      owner: owner.signer.address,
      mint: bootstrap.wrappedUsdcMint,
      threshold: THRESHOLD,
      slot: landed?.slot,
      expiry,
    });

    // The contexts closed, their rent to the fee payer; the token account's lamports unchanged.
    await closeContexts(proofs);
    // Every account the proofs created (both contexts and the range proof's record account).
    const created = proofs.cleanup.map(
      (instruction) => instruction.accounts[0]?.address as Address,
    );
    expect(created).toEqual(expect.arrayContaining([proofs.equalityContext, proofs.rangeContext]));
    const left = await fetchEncodedAccounts(rpc, created, { commitment: "confirmed" });
    expect(left.map((account) => account.exists)).toEqual(created.map(() => false));
    expect(
      (await rpc.getBalance(owner.wusdc as Address, { commitment: "confirmed" }).send()).value,
    ).toBe(tokenLamportsBefore);
  }, 180_000);

  it("refuses proofs once the balance changed after them, with CiphertextMismatch", async () => {
    const proofs = await prove(THRESHOLD);
    // 1 wUSDC more arrives and is applied between the proofs and the verification.
    await fundLocalnetAccount(rpc, owner, bootstrap, USDC);
    await applyLocalnetPending(rpc, owner);
    const simulated = await simulateInstructions({
      rpc,
      feePayer: owner.signer.address,
      instructions: [await verifyInstruction(proofs, THRESHOLD, (await now()) + 3600n)],
    });
    expect(customError(simulated.err)).toBe(SOTTO_PROOFS_ERROR__CIPHERTEXT_MISMATCH);
    await closeContexts(proofs);
  }, 180_000);

  it("closes the record after its expiry, the rent to the owner (X-31)", async () => {
    const proofs = await prove(THRESHOLD);
    const nonce = await recordNonce(owner.wusdc as Address, programAddress);
    const expiry = (await now()) + 3n;
    await sendWithWallet({
      rpc,
      wallet: owner.wallet,
      version: 1,
      instructions: [await verifyInstruction(proofs, THRESHOLD, expiry, nonce)],
    });
    await closeContexts(proofs);
    const [record] = await findProofRecordPda(
      { tokenAccount: owner.wusdc as Address, nonce },
      { programAddress },
    );
    const close = getCloseProofRecordInstruction(
      { proofRecord: record, owner: owner.signer },
      { programAddress },
    );
    // Wait until the chain's clock reaches the expiry.
    while ((await now()) < expiry) await new Promise((resolve) => setTimeout(resolve, 500));
    const rent = (await rpc.getBalance(record, { commitment: "confirmed" }).send()).value;
    expect(rent).toBeGreaterThan(0n);
    await sendWithWallet({ rpc, wallet: owner.wallet, version: 1, instructions: [close] });
    expect((await fetchEncodedAccount(rpc, record, { commitment: "confirmed" })).exists).toBe(
      false,
    );
  }, 180_000);
});
