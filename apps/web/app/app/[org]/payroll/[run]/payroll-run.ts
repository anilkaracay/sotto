"use client";

// A payroll run in the owner's tab (06 section 7, D-21, AC-08.4 to AC-08.6; step 2.3), after the
// server authorized it (I-6: the client executes only then):
// 1. the sender's account read fresh from chain, a pending balance applied first, once, and the
//    available balance checked against the lines still to pay;
// 2. the lines paid in chunks (payPayrollLines): each chunk's plans built in the tab's crypto worker
//    from the state each line leaves, signed with one wallet call (one Wallet Standard
//    signTransaction call; one call per transaction if the wallet fails the batch call, D-26), sent
//    line by line, every signature recorded before its transaction is sent (I-7);
// 3. after each chunk: the balance checked against the chunk's prediction, the chunk waited to
//    finality, then the self and recipient disclosures of its lines under one manifest the owner
//    signs (X-33, AC-08.6);
// 4. a failed line stops the run: its proof accounts are closed, its attempt and the run's stop are
//    recorded, and Resume pays the rest from chain state.
import {
  associatedTokenAccount,
  ChunkStepError,
  payPayrollLines,
  type PaidLine,
  type TransferTransactionRole,
} from "@sotto/sdk/confidential/public";
import {
  buildManifest,
  manifestMessage,
  validatePayload,
  type DisclosurePayloadV1,
} from "@sotto/sdk/disclosure";
import { verifyViewKeyRegistration } from "@sotto/sdk/keys/public";
import {
  fromPortableInstruction,
  sendWithWallet,
  waitForConfirmation,
  WalletSigningError,
} from "@sotto/sdk/tx";
import { address, fetchEncodedAccount, type Signature } from "@solana/kit";
import { ApiCallError, callApi } from "../../../../../lib/client/api.ts";
import { browserRpc } from "../../../../../lib/client/rpc.ts";
import {
  describeTransactionError,
  isWalletCancel,
} from "../../../../../lib/client/transactions.ts";
import { reportComparison } from "../../../../../lib/client/wallet-report.ts";
import { withWalletWords } from "../../../../../lib/client/wallet-words.ts";
import type { CryptoWorkerClient } from "../../../../../lib/crypto-worker/client.ts";
import { formatUsdc, type PayrollLinePrivate } from "../../../../../lib/payroll.ts";
import type { PayrollLineView } from "../../../../../lib/server/payroll.ts";
import type { Connected } from "../../../_components/confidential/context.tsx";

export type ViewerKeyRecord = {
  userId: string;
  wallet: string;
  publicKey: string;
  signature: string;
};

/** A line with its opened blob and the recipient's registered viewing key, if any. */
export type RunLine = {
  line: PayrollLineView;
  secret: PayrollLinePrivate;
  viewerKey: ViewerKeyRecord | null;
};

export type DisclosureResult = {
  /** Lines whose records were saved. */
  saved: number;
  /** Of those, lines whose recipient has no viewing key yet (only the owner's record). */
  ownerOnly: number;
  problem: string | null;
};

export type PayrollRunOutcome =
  | { kind: "done"; landed: number; records: DisclosureResult }
  | { kind: "stopped"; landed: number; message: string; records: DisclosureResult };

const ROLE_WORDS: Record<TransferTransactionRole, string> = {
  proof: "verifying a proof",
  transfer: "sending the transfer",
  cleanup: "closing the proof accounts",
};

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/**
 * A write to the Sotto API that waits and tries again while the per session write limit answers 429
 * (08 section 6): a line's signature record is idempotent, and nothing is sent before it succeeds.
 */
async function record<T>(path: string, body: unknown): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await callApi<T>(path, { method: "POST", body });
    } catch (error) {
      if (!(error instanceof ApiCallError) || error.status !== 429 || attempt >= 6) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }
}

async function readAccount(at: string): Promise<Uint8Array | null> {
  const account = await fetchEncodedAccount(browserRpc(), address(at), { commitment: "confirmed" });
  return account.exists ? new Uint8Array(account.data) : null;
}

const lineWords = (lines: readonly RunLine[]) => {
  const first = lines[0]?.line.lineNo;
  const last = lines.at(-1)?.line.lineNo;
  return first === last ? `line ${first}` : `lines ${first} to ${last}`;
};

/** I-8: a viewer's key is used only after its registration signature verifies. */
async function verified(key: ViewerKeyRecord | null): Promise<boolean> {
  if (!key) return false;
  return verifyViewKeyRegistration({
    wallet: key.wallet,
    publicKey: fromBase64(key.publicKey),
    signature: fromBase64(key.signature),
  });
}

/**
 * AC-08.6, X-33: the owner's self disclosure and the recipient's of each settled line, under one
 * manifest the owner wallet signs.
 */
export async function discloseLines(options: {
  orgId: string;
  lines: readonly { line: RunLine; transferSignature: string }[];
  owner: ViewerKeyRecord;
  connected: Connected;
  worker: () => CryptoWorkerClient;
}): Promise<DisclosureResult> {
  if (options.lines.length === 0) return { saved: 0, ownerOnly: 0, problem: null };
  if (!(await verified(options.owner))) {
    return { saved: 0, ownerOnly: 0, problem: "Your viewing key did not verify." };
  }
  const items: {
    id: string;
    viewerUserId: string;
    subject: string;
    ciphertext: Uint8Array;
  }[] = [];
  let ownerOnly = 0;
  for (const { line, transferSignature } of options.lines) {
    const payload: DisclosurePayloadV1 = validatePayload({
      v: 1,
      org: options.orgId,
      kind: "payroll_line",
      direction: "out",
      category: "payroll",
      subject: line.line.id,
      amount: line.secret.amount,
      currency: "USDC",
      memo: line.secret.memo,
      gross: line.secret.gross,
      tax: line.secret.tax,
      counterparty: line.line.recipient.displayName,
      signatures: [transferSignature],
      created_at: new Date().toISOString(),
    });
    const viewers = [options.owner];
    if (await verified(line.viewerKey)) viewers.push(line.viewerKey as ViewerKeyRecord);
    else ownerOnly += 1;
    for (const viewer of viewers) {
      items.push({
        id: crypto.randomUUID(),
        viewerUserId: viewer.userId,
        subject: line.line.id,
        ciphertext: await options.worker().seal(fromBase64(viewer.publicKey), payload),
      });
    }
  }
  const manifest = await buildManifest({
    org: options.orgId,
    createdAt: new Date().toISOString(),
    items: items.map((item) => ({
      id: item.id,
      viewer: item.viewerUserId,
      ciphertext: item.ciphertext,
    })),
  });
  const signature = await options.connected.sign(await manifestMessage(manifest));
  if (typeof signature === "string") {
    return {
      saved: 0,
      ownerOnly: 0,
      problem: withWalletWords(
        "Your wallet did not sign the payroll records, so they were not saved. The payments themselves are done.",
        options.connected.walletWords(),
      ),
    };
  }
  await callApi(`/api/orgs/${options.orgId}/disclosures`, {
    method: "POST",
    body: {
      manifest,
      signature: toBase64(signature),
      items: items.map((item) => ({
        id: item.id,
        viewerUserId: item.viewerUserId,
        grantId: null,
        kind: "payroll_line",
        subject: item.subject,
        ciphertext: toBase64(item.ciphertext),
      })),
    },
  });
  return { saved: options.lines.length, ownerOnly, problem: null };
}

function mergeRecords(a: DisclosureResult, b: DisclosureResult): DisclosureResult {
  return {
    saved: a.saved + b.saved,
    ownerOnly: a.ownerOnly + b.ownerOnly,
    problem: a.problem ?? b.problem,
  };
}

export async function runPayroll(options: {
  orgId: string;
  runId: string;
  /** The lines still to pay, in order. */
  lines: readonly RunLine[];
  owner: ViewerKeyRecord;
  wrappedMint: string;
  connected: Connected;
  worker: () => CryptoWorkerClient;
  onProgress: (text: string) => void;
  /** A line's transfer confirmed onchain. */
  onLanded: (lineId: string) => void;
}): Promise<PayrollRunOutcome> {
  const { connected, orgId, runId, onProgress } = options;
  let records: DisclosureResult = { saved: 0, ownerOnly: 0, problem: null };
  const stop = async (message: string, landed: number, errorCode: string) => {
    await callApi(`/api/orgs/${orgId}/payroll-runs/${runId}/executions`, {
      method: "POST",
      body: { status: "stopped", errorCode },
    }).catch(() => undefined);
    return { kind: "stopped" as const, landed, message, records };
  };
  const signer = connected.signer;
  const batch = connected.batchSigner;
  if (!signer || !batch) {
    return stop("Your wallet cannot sign on this network.", 0, "wallet_unavailable");
  }
  const rpc = browserRpc();
  const version = connected.version;
  const onSignedMessage = (comparison: Parameters<typeof reportComparison>[1]) =>
    reportComparison(connected.info, comparison);
  const mint = address(options.wrappedMint);
  const sourceToken = await associatedTokenAccount(signer.address, mint);

  // 06 section 7 step 1: a pending balance is applied once, from fresh state.
  onProgress("Reading your account from the network…");
  let source = await readAccount(sourceToken);
  if (!source) return stop("Your wUSDC account does not exist yet.", 0, "no_source_account");
  let decrypted = await options.worker().decrypt(source);
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
    if (!source) return stop("Your wUSDC account could not be read.", 0, "no_source_account");
    decrypted = await options.worker().decrypt(source);
  }
  const total = options.lines.reduce((sum, line) => sum + BigInt(line.secret.amount), 0n);
  if (decrypted.available < total) {
    return stop(
      `Your available confidential balance is below what these lines pay (${formatUsdc(total)}). Nothing was sent.`,
      0,
      "insufficient_balance",
    );
  }

  const byId = new Map(options.lines.map((line) => [line.line.id, line]));
  const landed: PaidLine[] = [];
  let remaining = [...options.lines];
  let signing: "batch" | "each" = "batch";
  for (;;) {
    const payments = await Promise.all(
      remaining.map(async (line) => ({
        id: line.line.id,
        destinationToken: await associatedTokenAccount(address(line.line.recipient.wallet), mint),
        amount: BigInt(line.secret.amount),
      })),
    );
    const outcome = await payPayrollLines({
      rpc,
      wallet: signing === "batch" ? batch : signer,
      signing,
      version,
      sourceToken,
      mint,
      payments,
      buildChunk: async (input) => {
        const chunk = await options.worker().transferChunk(
          {
            sourceToken,
            sourceAccount: input.source,
            mint,
            mintAccount: input.mint,
            lines: input.lines.map((line) => ({
              destinationToken: line.destinationToken,
              destinationAccount: line.destination,
              amount: line.amount,
            })),
            version,
          },
          (space) => rpc.getMinimumBalanceForRentExemption(space).send(),
        );
        return {
          lines: chunk.plans.map((plan) => ({
            transactions: plan.transactions,
            cosign: (transaction) => options.worker().cosign(plan.planId, transaction),
          })),
          cleanups: chunk.plans.map((plan) => plan.cleanup),
          availableAfter: chunk.availableAfter,
          release: async () => {
            await Promise.all(
              chunk.plans.map((plan) =>
                options
                  .worker()
                  .endPlan(plan.planId)
                  .catch(() => undefined),
              ),
            );
          },
        };
      },
      onProgress: (event) => {
        const line = byId.get(event.line.id);
        if (!line) return;
        if (event.kind === "preparing") onProgress("Preparing the next lines in this tab…");
        if (event.kind === "signing") onProgress("Approve the payroll lines in your wallet…");
        if (event.kind === "sending") {
          onProgress(`Sending line ${line.line.lineNo} to ${line.line.recipient.displayName}…`);
        }
      },
      // 08 section 3, I-7: each signature is recorded before its transaction is sent.
      onSignature: async (payment, role, signature) => {
        const line = byId.get(payment.id);
        if (!line) throw new Error("unknown line");
        await record(`/api/orgs/${orgId}/payroll-runs/${runId}/lines/${payment.id}/executions`, {
          status: "sent",
          attemptNo: line.line.attempts.length + 1,
          signature,
          transfer: role === "transfer",
        });
      },
      onSignedMessage,
      onLineLanded: (paid) => options.onLanded(paid.payment.id),
      onChunkLanded: async (chunk) => {
        const lines = chunk.lines
          .map((paid) => byId.get(paid.payment.id))
          .filter((line): line is RunLine => line !== undefined);
        // 06 section 7: the balance is the one the chunk's plans were built toward. A check that
        // cannot run now (the network) records nothing rather than a verdict.
        if (chunk.availableAfter !== null) {
          try {
            const after = await readAccount(sourceToken);
            const ok =
              after !== null &&
              (await options.worker().decrypt(after)).available === chunk.availableAfter;
            await callApi(`/api/orgs/${orgId}/payroll-runs/${runId}/executions`, {
              method: "POST",
              body: { status: "integrity", ok },
            });
          } catch {
            // No verdict.
          }
        }
        // X-33: the chunk's records once it is final; if that cannot be done now, the run page and a
        // resume save the missing ones later.
        onProgress(`Waiting for ${lineWords(lines)} to settle on Solana…`);
        let saved: DisclosureResult;
        try {
          const last = chunk.lines.at(-1);
          if (last) {
            await waitForConfirmation(
              rpc,
              last.transferSignature as Signature,
              120_000,
              "finalized",
            );
          }
          onProgress(
            `Saving the records of ${lineWords(lines)}, encrypted for you and each recipient…`,
          );
          saved = await discloseLines({
            orgId,
            lines: chunk.lines.map((paid) => ({
              line: byId.get(paid.payment.id) as RunLine,
              transferSignature: paid.transferSignature,
            })),
            owner: options.owner,
            connected,
            worker: options.worker,
          });
        } catch {
          saved = {
            saved: 0,
            ownerOnly: 0,
            problem: "The payroll records could not be saved yet; open the run again to save them.",
          };
        }
        records = mergeRecords(records, saved);
      },
      confirmTimeoutMs: 60_000,
    });
    landed.push(...outcome.landed);
    const stopped = outcome.stopped;
    if (!stopped) return { kind: "done", landed: landed.length, records };
    // D-26: a wallet that fails the batch call signs one transaction at a time instead.
    const cause = stopped.error instanceof ChunkStepError ? stopped.error.cause : stopped.error;
    if (
      signing === "batch" &&
      stopped.error instanceof WalletSigningError &&
      !isWalletCancel(stopped.error) &&
      !stopped.sent
    ) {
      signing = "each";
      const done = new Set(landed.map((paid) => paid.payment.id));
      remaining = options.lines.filter((line) => !done.has(line.line.id));
      continue;
    }
    const line = byId.get(stopped.payment.id);
    const where = line ? `Line ${line.line.lineNo} (${line.line.recipient.displayName})` : "A line";
    const step = stopped.step
      ? ` failed while ${ROLE_WORDS[stopped.step.role]}`
      : " did not complete";
    // A record the server refused (for example a run the worker stopped meanwhile) says why itself.
    const reason =
      cause instanceof ApiCallError
        ? `${cause.message}.`
        : describeTransactionError(cause, connected.info.name);
    if (line && stopped.signatures.length > 0) {
      await callApi(`/api/orgs/${orgId}/payroll-runs/${runId}/lines/${line.line.id}/executions`, {
        method: "POST",
        body: {
          status: stopped.cleaned ? "failed_clean" : "failed",
          attemptNo: line.line.attempts.length + 1,
          errorCode: stopped.step ? `${stopped.step.role}:${stopped.step.index + 1}` : "stopped",
          signatures: stopped.cleanupSignatures,
        },
      }).catch(() => undefined);
    }
    const cleanup = stopped.sent
      ? stopped.cleaned
        ? " Sotto closed the proof accounts this line created, so no rent is left behind."
        : " Sotto could not close every proof account this line created; Resume closes them."
      : " Nothing of this line was sent.";
    const paid =
      landed.length > 0
        ? ` ${landed.length} ${landed.length === 1 ? "line was" : "lines were"} paid and stay paid; Resume pays the rest.`
        : " No line was paid; Resume tries again.";
    return stop(
      `${where}${step}: ${reason}${cleanup}${paid}`,
      landed.length,
      stopped.step ? `${stopped.step.role}:${stopped.step.index + 1}` : "stopped",
    );
  }
}
