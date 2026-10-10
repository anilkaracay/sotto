"use client";

// One attempt of a single confidential payment in the owner's tab (06 section 5, AC-06.4, AC-06.5;
// step 1.9), after the server authorized it (I-6: the client executes only then):
// 1. read the sender's and the recipient's wrapped accounts (wUSDC or wdevUSD) and the mint fresh from chain; apply a
//    pending balance first (06 section 5 step 1);
// 2. build the transfer plan in the tab's crypto worker (the keys stay there; rent is read here);
// 3. send its transactions in order through the wallet path of 06 section 9, the worker adding the
//    signatures of the proof accounts, each signature recorded before its transaction is sent;
// 4. if a step fails, close the proof accounts that exist (rent to the fee payer) and record the
//    attempt as failed_clean, so a retry is safe;
// 5. after the transfer is finalized, check that the new available balance is the previous one minus
//    the amount (06 section 5 step 5), and write the self and recipient disclosures with a manifest
//    the owner wallet signs (07 section 4, AC-06.4 Phase 1 part), and since step 2.4 one for every
//    active grant whose scope covers the payment (AC-06.4 grant part). Once the transfer landed, a
//    record that cannot be saved is a problem of the record, never a failed payment.
import {
  associatedTokenAccount,
  closeProofAccounts,
  isUndecidedTransfer,
  sendTransferTransactions,
  TransferStepError,
  type TransferTransactionRole,
} from "@sotto/sdk/confidential/public";
import { validatePayload, type DisclosurePayloadV1 } from "@sotto/sdk/disclosure";
import { verifyViewKeyRegistration } from "@sotto/sdk/keys/public";
import { fromPortableInstruction, sendWithWallet } from "@sotto/sdk/tx";
import { address, fetchEncodedAccount, fetchEncodedAccounts } from "@solana/kit";
import { ApiCallError, callApi } from "../../../../../lib/client/api.ts";
import { activeGrantViewers, coveringGrants } from "../../../../../lib/client/grant-viewers.ts";
import { storeRecords, type RecordItem } from "../../../../../lib/client/records.ts";
import { browserRpc } from "../../../../../lib/client/rpc.ts";
import { describeTransactionError } from "../../../../../lib/client/transactions.ts";
import { withWalletWords } from "../../../../../lib/client/wallet-words.ts";
import { reportComparison } from "../../../../../lib/client/wallet-report.ts";
import type { CryptoWorkerClient } from "../../../../../lib/crypto-worker/client.ts";
import type { PaymentCategory } from "../../../../../lib/payment.ts";
import type { Connected } from "../../../_components/confidential/context.tsx";
import type { AssetWords } from "../../../../../lib/asset-words.ts";

export type ViewerKeyRecord = {
  userId: string;
  wallet: string;
  publicKey: string;
  signature: string;
};

export type PaymentRunInput = {
  orgId: string;
  paymentId: string;
  attemptNo: number;
  amount: bigint;
  memo: string | null;
  category: PaymentCategory;
  recipient: { displayName: string; wallet: string; viewerKey: ViewerKeyRecord | null };
  owner: ViewerKeyRecord;
  wrappedMint: string;
  /** The organization's asset (step 4.3): the record's currency and the words of a failure. */
  asset: AssetWords;
};

export type PaymentRunOutcome =
  | {
      kind: "settled";
      transferSignature: string;
      integrityOk: boolean;
      /** Who got a disclosure, or why none was written. */
      disclosed: Disclosed;
    }
  | { kind: "failed"; message: string };

const ROLE_WORDS: Record<TransferTransactionRole, string> = {
  proof: "verifying a proof",
  transfer: "sending the transfer",
  cleanup: "closing the proof accounts",
};

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

async function readAccount(at: string): Promise<Uint8Array | null> {
  const account = await fetchEncodedAccount(browserRpc(), address(at), { commitment: "confirmed" });
  return account.exists ? new Uint8Array(account.data) : null;
}

export async function runPayment(options: {
  input: PaymentRunInput;
  connected: Connected;
  worker: () => CryptoWorkerClient;
  onProgress: (text: string) => void;
}): Promise<PaymentRunOutcome> {
  const { input, connected, onProgress } = options;
  const signer = connected.signer;
  if (!signer) return { kind: "failed", message: "Your wallet cannot sign on this network." };
  const rpc = browserRpc();
  const version = connected.version;
  const onSignedMessage = (comparison: Parameters<typeof reportComparison>[1]) =>
    reportComparison(connected.info, comparison);
  const mint = address(input.wrappedMint);
  const sourceToken = await associatedTokenAccount(signer.address, mint);
  const destinationToken = await associatedTokenAccount(address(input.recipient.wallet), mint);

  // 06 section 5 step 1: a pending balance is applied first, from fresh state.
  onProgress("Reading your account and the recipient's from the network…");
  let source = await readAccount(sourceToken);
  if (!source)
    return {
      kind: "failed",
      message: `Your ${input.asset.wrappedSymbol} account does not exist yet.`,
    };
  const decrypted = await options.worker().decrypt(source);
  if (decrypted.pending > 0n) {
    onProgress("Applying your pending balance first…");
    const apply = await options.worker().applyInstruction(sourceToken, source);
    await sendWithWallet({
      rpc,
      wallet: signer,
      version,
      instructions: [fromPortableInstruction(apply)],
      onSignedMessage,
    });
    source = await readAccount(sourceToken);
    if (!source)
      return {
        kind: "failed",
        message: `Your ${input.asset.wrappedSymbol} account could not be read.`,
      };
  }
  const [destination, mintAccount] = await Promise.all([
    readAccount(destinationToken),
    readAccount(mint),
  ]);
  if (!destination) {
    return {
      kind: "failed",
      message: `The recipient's ${input.asset.wrappedSymbol} account does not exist onchain.`,
    };
  }
  if (!mintAccount)
    return { kind: "failed", message: `The ${input.asset.wrappedSymbol} mint could not be read.` };

  onProgress("Preparing the proofs in this tab…");
  const plan = await options.worker().transferPlan(
    {
      sourceToken,
      sourceAccount: source,
      destinationToken,
      destinationAccount: destination,
      mint,
      mintAccount,
      amount: input.amount,
      version,
    },
    (space) => rpc.getMinimumBalanceForRentExemption(space).send(),
  );
  const cosign = (transaction: Parameters<CryptoWorkerClient["cosign"]>[1]) =>
    options.worker().cosign(plan.planId, transaction);
  const total = plan.transactions.length;
  let opened = false;
  const record = (body: unknown) =>
    callApi(`/api/orgs/${input.orgId}/payments/${input.paymentId}/executions`, {
      method: "POST",
      body,
    });

  /** After the transfer landed: 06 section 5 step 5, then the payment's records. */
  const finish = async (transferSignature: string): Promise<PaymentRunOutcome> => {
    // The new available balance is the previous one minus the amount.
    onProgress("Checking your new balance…");
    const after = await readAccount(sourceToken);
    const integrityOk =
      after !== null &&
      (await options.worker().decrypt(after)).available === plan.availableBefore - input.amount;
    await record({ status: "integrity", ok: integrityOk });

    onProgress("Saving the payment record, encrypted for you and the recipient…");
    const disclosed = await disclose(input, connected, options.worker, transferSignature);
    return { kind: "settled", transferSignature, integrityOk, disclosed };
  };

  try {
    const sent = await sendTransferTransactions({
      rpc,
      wallet: signer,
      version,
      transactions: plan.transactions,
      cosign,
      onSignedMessage,
      onStep: (index, role) => onProgress(`Step ${index + 1} of ${total}: ${ROLE_WORDS[role]}…`),
      // 08 section 3: every signature is recorded before its transaction is sent.
      onSignature: async (_, role, signature) => {
        await record({
          status: "sent",
          attemptNo: input.attemptNo,
          signature,
          transfer: role === "transfer",
        });
        opened = true;
      },
    });

    return await finish(sent.transferSignature);
  } catch (error) {
    if (!(error instanceof TransferStepError)) {
      return { kind: "failed", message: describeTransactionError(error, connected.info.name) };
    }
    // Step 4.9: the transfer was sent and the network did not say what became of it. It is not a
    // failure yet: nothing is closed and nothing is recorded as failed. Sotto's worker follows every
    // recorded signature, so the page follows the payment's status, and goes on when it settled.
    if (isUndecidedTransfer(error)) {
      const transferSignature = error.signatures[error.signatures.length - 1] ?? "";
      onProgress(
        "The network is slow to confirm the transfer. Waiting for Sotto to see it settle…",
      );
      if (await settledOnServer(input, UNDECIDED_WAIT_MS)) return await finish(transferSignature);
      return { kind: "failed", message: undecidedTransferMessage(transferSignature) };
    }
    const where = `Step ${error.index + 1} of ${total} (${ROLE_WORDS[error.role]}) failed: ${describeTransactionError(error.cause, connected.info.name)}`;
    onProgress("Closing the proof accounts this attempt created…");
    let cleaned: boolean;
    let closing: string[] = [];
    try {
      closing = (
        await closeProofAccounts({
          rpc,
          wallet: signer,
          version,
          cleanup: plan.cleanup,
          cosign,
          onSignedMessage,
        })
      ).signatures;
      const left = await fetchEncodedAccounts(
        rpc,
        plan.cleanup.map((instruction) => instruction.accounts[0]?.address ?? sourceToken),
        { commitment: "confirmed" },
      );
      cleaned = left.every((account) => !account.exists);
    } catch {
      cleaned = false;
    }
    if (opened) {
      await record({
        status: cleaned ? "failed_clean" : "failed",
        attemptNo: input.attemptNo,
        errorCode: `${error.role}:${error.index + 1}`,
        signatures: closing,
      }).catch(() => undefined);
    }
    return {
      kind: "failed",
      message: cleaned
        ? `${where} Sotto closed the proof accounts this attempt created, so no rent is left behind, and your balances are unchanged. You can try again.`
        : `${where} Sotto could not close every proof account this attempt created; try again to close them.`,
    };
  } finally {
    await options
      .worker()
      .endPlan(plan.planId)
      .catch(() => undefined);
  }
}

/** How long the page follows a payment whose transfer was sent but not confirmed to it (step 4.9). */
export const UNDECIDED_WAIT_MS = 120_000;

/** What the owner reads when the transfer was sent and neither the network nor Sotto saw it settle in time. */
export function undecidedTransferMessage(transferSignature: string): string {
  return `The transfer was sent (transaction ${transferSignature.slice(0, 12)}…), but the network did not confirm it in time. Sotto keeps checking it: this payment shows Settled under Recent payments once it lands. Do not pay again before then.`;
}

/** Follows the payment's status on the server, where the worker settles it from its signatures. */
async function settledOnServer(input: PaymentRunInput, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { payment } = await callApi<{ payment: { status: string } }>(
        `/api/orgs/${input.orgId}/payments/${input.paymentId}`,
      );
      if (payment.status === "settled") return true;
      if (payment.status === "failed") return false;
    } catch {
      // Asked again below.
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return false;
}

/** What the payment's records reached; `grantCopiesMissing` when a covering grant may lack its copy. */
export type Disclosed = {
  self: boolean;
  recipient: boolean;
  grantCopiesMissing: boolean;
  problem: string | null;
};

/**
 * AC-06.4: the owner's self disclosure, the recipient's and, since step 2.4, one for every active grant
 * covering the payment, in one signed manifest (`storeRecords`). It never throws: the transfer has
 * landed, so a record that cannot be saved is reported as such.
 */
async function disclose(
  input: PaymentRunInput,
  connected: Connected,
  worker: () => CryptoWorkerClient,
  transferSignature: string,
): Promise<Disclosed> {
  try {
    const payload: DisclosurePayloadV1 = validatePayload({
      v: 1,
      org: input.orgId,
      kind: "payment",
      direction: "out",
      category: input.category,
      subject: input.paymentId,
      amount: input.amount.toString(),
      currency: input.asset.symbol,
      memo: input.memo,
      gross: null,
      tax: null,
      counterparty: input.recipient.displayName,
      signatures: [transferSignature],
      created_at: new Date().toISOString(),
    });
    // I-8: a viewer's key is used only after its registration signature verifies.
    const viewers: ViewerKeyRecord[] = [];
    for (const key of [input.owner, input.recipient.viewerKey]) {
      if (!key) continue;
      const verified = await verifyViewKeyRegistration({
        wallet: key.wallet,
        publicKey: fromBase64(key.publicKey),
        signature: fromBase64(key.signature),
      });
      if (verified) viewers.push(key);
    }
    const self = viewers.some((viewer) => viewer.userId === input.owner.userId);
    const recipient = viewers.some((viewer) => viewer.userId === input.recipient.viewerKey?.userId);
    if (!self) {
      return {
        self: false,
        recipient: false,
        grantCopiesMissing: false,
        problem: "Your viewing key did not verify.",
      };
    }
    const items: RecordItem[] = [];
    for (const viewer of viewers) {
      items.push({
        id: crypto.randomUUID(),
        viewerUserId: viewer.userId,
        grantId: null,
        kind: "payment",
        subject: input.paymentId,
        ciphertext: await worker().seal(fromBase64(viewer.publicKey), payload),
      });
    }
    // AC-06.4 grant part: every active grant whose scope covers the payment (I-8 checked there). The
    // grants that cannot be read now get their copy from Share past records.
    const grants = await activeGrantViewers(input.orgId).catch(() => null);
    for (const grant of coveringGrants(grants ?? [], "payment")) {
      items.push({
        id: crypto.randomUUID(),
        viewerUserId: grant.viewer.userId,
        grantId: grant.grantId,
        kind: "payment",
        subject: input.paymentId,
        ciphertext: await worker().seal(fromBase64(grant.viewer.publicKey), payload),
      });
    }
    const stored = await storeRecords({
      orgId: input.orgId,
      items,
      sign: (message) => connected.sign(message),
    });
    if (stored.kind === "not_signed") {
      return {
        self: false,
        recipient: false,
        grantCopiesMissing: false,
        problem: withWalletWords(
          "Your wallet did not sign the payment record, so it was not saved.",
          connected.walletWords(),
        ),
      };
    }
    return {
      self,
      recipient,
      grantCopiesMissing: grants === null || stored.withoutGrants,
      problem: null,
    };
  } catch (error) {
    return {
      self: false,
      recipient: false,
      grantCopiesMissing: false,
      problem: `The payment record could not be saved: ${
        error instanceof ApiCallError ? error.message : "Sotto could not store it."
      }`,
    };
  }
}
