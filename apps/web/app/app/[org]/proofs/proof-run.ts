"use client";

// One proof of funds in the owner's tab (F-13, AC-13.1 to AC-13.4, 06 section 8; step 2.8):
// 1. read the owner's wUSDC account fresh from chain; apply a pending balance first (06 section 8
//    step 1);
// 2. build the proofs of "available balance at least X" in the tab's crypto worker; below X the worker
//    stops before any proof exists and the result is Not proven, with nothing sent (AC-13.2);
// 3. send the proof transactions through the wallet path of 06 section 9 (the worker adds the proof
//    accounts' signatures), then verify_balance_threshold with a nonce whose record address has bump
//    255, the chosen expiry and the counterparty hash of a fresh 16 byte salt (X-32);
// 4. if the balance changed since the proofs (CiphertextMismatch), close the proof accounts, read the
//    account again and try once more, then explain (06 section 8);
// 5. close the proof accounts, both contexts and the range proof's record account, their rent to the
//    fee payer (AC-13.4), and give the server the label and salt, which never go onchain.
import { associatedTokenAccount, closeProofAccounts } from "@sotto/sdk/confidential/public";
import {
  counterpartyHash,
  getVerifyBalanceThresholdInstructionAsync,
  proofVerifiedEvent,
  randomBytes16,
  recordNonce,
  SOTTO_PROOFS_ERROR__CIPHERTEXT_MISMATCH,
  sottoProofsErrorCode,
} from "@sotto/sdk/proofs";
import { fromPortableInstruction, sendWithWallet } from "@sotto/sdk/tx";
import { address, fetchEncodedAccount, fetchEncodedAccounts } from "@solana/kit";
import { ApiCallError, callApi } from "../../../../lib/client/api.ts";
import { browserRpc } from "../../../../lib/client/rpc.ts";
import { describeTransactionError } from "../../../../lib/client/transactions.ts";
import { reportComparison } from "../../../../lib/client/wallet-report.ts";
import {
  CryptoWorkerError,
  type CryptoWorkerClient,
} from "../../../../lib/crypto-worker/client.ts";
import { expiryFrom, proofErrorWords, USDC_DECIMALS } from "../../../../lib/proofs.ts";
import type { Connected } from "../../_components/confidential/context.tsx";
import type { AssetWords } from "../../../../lib/asset-words.ts";

export type ProofRunInput = {
  orgId: string;
  threshold: bigint;
  label: string;
  validityDays: number;
  wrappedMint: string;
  program: string;
  /** The organization's asset (step 4.3): the words of a failure. */
  asset: AssetWords;
};

export type ProvenRecord = {
  address: string;
  threshold: bigint;
  label: string;
  slot: bigint;
  expiry: bigint;
  signature: string;
};

export type ProofRunOutcome =
  | { kind: "proven"; record: ProvenRecord; closed: boolean; stored: string | null }
  | { kind: "not_proven" }
  | { kind: "failed"; message: string };

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

async function readAccount(at: string): Promise<Uint8Array | null> {
  const account = await fetchEncodedAccount(browserRpc(), address(at), { commitment: "confirmed" });
  return account.exists ? new Uint8Array(account.data) : null;
}

/** Thrown when the balance changed between the proofs and the verification. */
class BalanceMoved extends Error {}

export async function runProof(options: {
  input: ProofRunInput;
  connected: Connected;
  worker: () => CryptoWorkerClient;
  onProgress: (text: string) => void;
  /** The current time, for the expiry (tests pass a fixed one). */
  now?: () => Date;
}): Promise<ProofRunOutcome> {
  const { input, connected, onProgress } = options;
  const signer = connected.signer;
  if (!signer) return { kind: "failed", message: "Your wallet cannot sign on this network." };
  const rpc = browserRpc();
  const version = connected.version;
  const onSignedMessage = (comparison: Parameters<typeof reportComparison>[1]) =>
    reportComparison(connected.info, comparison);
  const program = address(input.program);
  const mint = address(input.wrappedMint);
  const token = await associatedTokenAccount(signer.address, mint);

  // 06 section 8 step 1: a pending balance is applied first, from fresh state.
  onProgress("Reading your account from the network…");
  let account = await readAccount(token);
  if (!account)
    return {
      kind: "failed",
      message: `Your ${input.asset.wrappedSymbol} account does not exist yet.`,
    };
  if ((await options.worker().decrypt(account)).pending > 0n) {
    onProgress("Applying your pending balance first…");
    const apply = await options.worker().applyInstruction(token, account);
    await sendWithWallet({
      rpc,
      wallet: signer,
      version,
      instructions: [fromPortableInstruction(apply)],
      onSignedMessage,
    });
  }

  const attempt = async (): Promise<ProofRunOutcome> => {
    account = await readAccount(token);
    if (!account)
      return {
        kind: "failed",
        message: `Your ${input.asset.wrappedSymbol} account could not be read.`,
      };
    onProgress("Preparing the proofs in this tab…");
    let proofs;
    try {
      proofs = await options
        .worker()
        .balanceProofs(
          { token, account, mint, decimals: USDC_DECIMALS, threshold: input.threshold },
          (space) => rpc.getMinimumBalanceForRentExemption(space).send(),
        );
    } catch (error) {
      // AC-13.2: below the threshold nothing was built, signed or sent.
      if (error instanceof CryptoWorkerError && error.code === "insufficient_balance") {
        return { kind: "not_proven" };
      }
      throw error;
    }
    const cosign = (transaction: Parameters<CryptoWorkerClient["cosign"]>[1]) =>
      options.worker().cosign(proofs.planId, transaction);
    const close = async (): Promise<boolean> => {
      onProgress("Closing the proof accounts, their rent back to you…");
      try {
        await closeProofAccounts({
          rpc,
          wallet: signer,
          version,
          cleanup: proofs.cleanup,
          cosign,
          onSignedMessage,
        });
        const left = await fetchEncodedAccounts(
          rpc,
          proofs.cleanup.map((instruction) => instruction.accounts[0]?.address ?? token),
          { commitment: "confirmed" },
        );
        return left.every((entry) => !entry.exists);
      } catch {
        return false;
      }
    };
    try {
      const total = proofs.transactions.length + 1;
      // The proof transactions only (no transfer), in order, each confirmed before the next.
      for (const [index, transaction] of proofs.transactions.entries()) {
        onProgress(`Step ${index + 1} of ${total}: verifying a proof…`);
        await sendWithWallet({
          rpc,
          wallet: signer,
          version: 0,
          instructions: transaction.instructions.map(fromPortableInstruction),
          cosign,
          onSignedMessage,
        });
      }
      onProgress(`Step ${total} of ${total}: recording the proof on Solana…`);
      const salt = randomBytes16();
      const nonce = await recordNonce(token, program);
      const expiry = expiryFrom((options.now ?? (() => new Date()))(), input.validityDays);
      const verify = await getVerifyBalanceThresholdInstructionAsync(
        {
          owner: signer,
          tokenAccount: token,
          equalityContext: address(proofs.equalityContext),
          rangeContext: address(proofs.rangeContext),
          payer: signer,
          threshold: input.threshold,
          nonce,
          expiry,
          counterpartyHash: await counterpartyHash(salt, input.label),
        },
        { programAddress: program },
      );
      let sent;
      try {
        sent = await sendWithWallet({
          rpc,
          wallet: signer,
          version,
          instructions: [verify],
          onSignedMessage,
        });
      } catch (error) {
        if (sottoProofsErrorCode(error, program) === SOTTO_PROOFS_ERROR__CIPHERTEXT_MISMATCH) {
          throw new BalanceMoved();
        }
        throw error;
      }
      const landed = await rpc
        .getTransaction(sent.signature as Parameters<typeof rpc.getTransaction>[0], {
          commitment: "confirmed",
          encoding: "json",
          maxSupportedTransactionVersion: 1,
        })
        .send();
      const event = proofVerifiedEvent(landed?.meta?.logMessages ?? []);
      if (!event) {
        return {
          kind: "failed",
          message: "The record was written, but its event could not be read.",
        };
      }
      const closed = await close();
      onProgress("Saving the counterparty label with Sotto…");
      let stored: string | null = null;
      try {
        await callApi(`/api/orgs/${input.orgId}/proofs`, {
          method: "POST",
          body: {
            recordAddress: event.record,
            counterpartyLabel: input.label,
            counterpartySalt: toBase64(salt),
          },
        });
      } catch (error) {
        stored =
          error instanceof ApiCallError
            ? error.message
            : "The counterparty label could not be saved with Sotto.";
      }
      return {
        kind: "proven",
        record: {
          address: event.record,
          threshold: event.threshold,
          label: input.label,
          slot: event.slot,
          expiry: event.expiry,
          signature: sent.signature,
        },
        closed,
        stored,
      };
    } catch (error) {
      const closed = await close();
      if (error instanceof BalanceMoved) throw error;
      const code = sottoProofsErrorCode(error, program);
      const words =
        code === null
          ? describeTransactionError(error, connected.info.name)
          : proofErrorWords(code, input.asset);
      return {
        kind: "failed",
        message: closed
          ? `${words} Sotto closed the proof accounts this attempt created, so no rent is left behind.`
          : `${words} Sotto could not close every proof account this attempt created; try again to close them.`,
      };
    } finally {
      await options
        .worker()
        .endPlan(proofs.planId)
        .catch(() => undefined);
    }
  };

  try {
    return await attempt();
  } catch (error) {
    if (!(error instanceof BalanceMoved)) {
      return { kind: "failed", message: describeTransactionError(error, connected.info.name) };
    }
  }
  // 06 section 8: the balance changed between reading and verifying; read again and retry once.
  onProgress("Your balance changed while proving. Reading it again and trying once more…");
  try {
    return await attempt();
  } catch (error) {
    if (error instanceof BalanceMoved) {
      return {
        kind: "failed",
        message:
          "Your balance changed twice while proving, so the proof no longer matched it and nothing was recorded. Pause payments to and from this account for a minute, then try again.",
      };
    }
    return { kind: "failed", message: describeTransactionError(error, connected.info.name) };
  }
}
