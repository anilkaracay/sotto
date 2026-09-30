"use client";

// Withdraw and unwrap (F-09, AC-09.1, 06 section 6; step 1.10), for the owner (a drawer on the
// overview) and for a recipient (the minimal recipient page). In the tab, with the keys unlocked:
// 1. the account is read fresh from chain and a pending balance is applied first;
// 2. the crypto worker builds the withdraw plan (two proofs, the withdraw, the closes; rent read here)
//    and the page sends it through the wallet path of 06 section 9, the worker adding the proof
//    accounts' signatures; a failed step is named and its proof accounts are closed;
// 3. Token Wrap `Unwrap` turns the withdrawn public wUSDC into USDC, if chosen. An unwrap that does
//    not complete leaves the wUSDC public, and the form offers to unwrap the public wUSDC balance.
// The withdrawn amount is public onchain by design (facts A2); balances are read from chain after.
import {
  associatedTokenAccount,
  closeProofAccounts,
  formatTokenAmount,
  parseTokenAmount,
  sendTransferTransactions,
  TransferStepError,
  type TransferTransactionRole,
} from "@sotto/sdk/confidential/public";
import { fromPortableInstruction, sendWithWallet } from "@sotto/sdk/tx";
import { unwrapInstructions } from "@sotto/sdk/wrap";
import { Button } from "@sotto/ui";
import { address, createNoopSigner, fetchEncodedAccount } from "@solana/kit";
import { useId, useState, type FormEvent } from "react";
import { browserRpc } from "../../../../lib/client/rpc.ts";
import { describeTransactionError } from "../../../../lib/client/transactions.ts";
import { reportComparison } from "../../../../lib/client/wallet-report.ts";
import {
  CryptoWorkerError,
  type CryptoWorkerClient,
} from "../../../../lib/crypto-worker/client.ts";
import styles from "./cards.module.css";
import { PausedNote } from "./paused-note.tsx";
import { useConfidential } from "./context.tsx";
import extra from "./confidential.module.css";
import { Amount, WithAmounts } from "../privacy.tsx";

const ROLE_WORDS: Record<TransferTransactionRole, string> = {
  proof: "verifying a proof",
  transfer: "withdrawing to your public wUSDC",
  cleanup: "closing the proof accounts",
};

type Outcome = { busy: string | null; problem: string | null; done: string | null };

export function WithdrawForm({ onDone }: { onDone?: () => void }) {
  const { network, connected, vault, refresh, data, blocked } = useConfidential();
  const id = useId();
  const [amount, setAmount] = useState("");
  const [unwrap, setUnwrap] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ busy: null, problem: null, done: null });
  const decimals = network.decimals ?? 6;
  const available = data.confidential.kind === "decrypted" ? data.confidential.available : null;
  const publicWusdc = data.wusdc?.status === "present" ? data.wusdc.amount : 0n;
  // F-19: a confidential withdrawal needs its proofs; unwrapping public wUSDC does not.
  const canRun = Boolean(connected?.signer && vault.unlocked && network.wrappedMint) && !blocked;

  /** Token Wrap `Unwrap` of public wUSDC to USDC (06 section 6, step 3), signed by the wallet. */
  async function sendUnwrap(amount: bigint): Promise<string> {
    const signer = connected?.signer;
    if (!signer || !connected || !network.usdcMint || !network.usdcTokenProgram) {
      throw new Error("This network has no USDC mint configured.");
    }
    const built = await unwrapInstructions({
      owner: createNoopSigner(signer.address),
      unwrappedMint: address(network.usdcMint),
      unwrappedTokenProgram: address(network.usdcTokenProgram),
      programAddress: address(network.tokenWrapProgram),
      amount,
    });
    const sent = await sendWithWallet({
      rpc: browserRpc(),
      wallet: signer,
      version: connected.version,
      instructions: built.instructions,
      onSignedMessage: (comparison) => reportComparison(connected.info, comparison),
    });
    return sent.signature;
  }

  /** Unwraps the whole public wUSDC balance, for example after an unwrap that did not complete. */
  async function unwrapPublic(amount: bigint) {
    const release = vault.hold();
    const shown = formatTokenAmount(amount, decimals);
    setOutcome({ busy: "Unwrapping the wUSDC to USDC…", problem: null, done: null });
    try {
      const signature = await sendUnwrap(amount);
      setOutcome({
        busy: null,
        problem: null,
        done: `Unwrapped ${shown} wUSDC to ${shown} USDC (transaction ${signature.slice(0, 12)}…).`,
      });
    } catch (error) {
      setOutcome({
        busy: null,
        problem: describeTransactionError(error, connected?.info.name),
        done: null,
      });
    } finally {
      release();
      await refresh();
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const base = parseTokenAmount(amount, decimals);
    if (base === null || base <= 0n) {
      setError(`Enter an amount above zero with at most ${decimals} decimals`);
      return;
    }
    setError(null);
    const signer = connected?.signer;
    if (!signer || !network.wrappedMint || !connected) return;
    const rpc = browserRpc();
    const version = connected.version;
    const onSignedMessage = (comparison: Parameters<typeof reportComparison>[1]) =>
      reportComparison(connected.info, comparison);
    const release = vault.hold();
    const say = (busy: string) => setOutcome({ busy, problem: null, done: null });
    let planId: string | null = null;
    try {
      const token = await associatedTokenAccount(signer.address, address(network.wrappedMint));
      const read = async () => {
        const account = await fetchEncodedAccount(rpc, token, { commitment: "confirmed" });
        if (!account.exists) throw new Error("Your wUSDC account does not exist yet.");
        return new Uint8Array(account.data);
      };
      say("Reading your account from the network…");
      let bytes = await read();
      if ((await vault.worker().decrypt(bytes)).pending > 0n) {
        say("Applying your pending balance first…");
        const apply = await vault.worker().applyInstruction(token, bytes);
        await sendWithWallet({
          rpc,
          wallet: signer,
          version,
          instructions: [fromPortableInstruction(apply)],
          onSignedMessage,
        });
        bytes = await read();
      }
      say("Preparing the proofs in this tab…");
      const plan = await vault
        .worker()
        .withdrawPlan(
          { token, account: bytes, mint: network.wrappedMint, decimals, amount: base, version },
          (space) => rpc.getMinimumBalanceForRentExemption(space).send(),
        );
      planId = plan.planId;
      const cosign = (transaction: Parameters<CryptoWorkerClient["cosign"]>[1]) =>
        vault.worker().cosign(plan.planId, transaction);
      const total = plan.transactions.length;
      const withdrawIndex = plan.transactions.findIndex((step) => step.role === "transfer");
      let withdrawSignature: string;
      // A closing step that failed after the withdraw landed is named with the result.
      let note = "";
      try {
        withdrawSignature = (
          await sendTransferTransactions({
            rpc,
            wallet: signer,
            version,
            transactions: plan.transactions,
            cosign,
            onSignedMessage,
            onStep: (index, role) => say(`Step ${index + 1} of ${total}: ${ROLE_WORDS[role]}…`),
          })
        ).transferSignature;
      } catch (error) {
        if (!(error instanceof TransferStepError)) throw error;
        say("Closing the proof accounts this attempt created…");
        const cleaned = await closeProofAccounts({
          rpc,
          wallet: signer,
          version,
          cleanup: plan.cleanup,
          cosign,
          onSignedMessage,
        }).then(
          () => true,
          () => false,
        );
        const where = `Step ${error.index + 1} of ${total} (${ROLE_WORDS[error.role]}) failed: ${describeTransactionError(error.cause, connected.info.name)}`;
        const rent = cleaned
          ? " Sotto closed the proof accounts this attempt created, so no rent is left behind."
          : " Sotto could not close every proof account this attempt created; they keep their rent until they are closed.";
        const landed =
          withdrawIndex >= 0 && error.index > withdrawIndex
            ? (error.signatures[withdrawIndex] ?? null)
            : null;
        if (!landed) {
          setOutcome({
            busy: null,
            problem: `${where}${rent} Your confidential balance is unchanged.`,
            done: null,
          });
          return;
        }
        withdrawSignature = landed;
        note = ` ${where}${rent}`;
      }
      const shown = `${formatTokenAmount(base, decimals)}`;
      let done = `Withdrew ${shown} wUSDC to your public balance (transaction ${withdrawSignature.slice(0, 12)}…).`;
      if (unwrap) {
        say("Unwrapping the wUSDC to USDC…");
        try {
          const unwrapped = await sendUnwrap(base);
          done = `Withdrew ${shown} wUSDC and unwrapped it to ${shown} USDC (transactions ${withdrawSignature.slice(0, 12)}… and ${unwrapped.slice(0, 12)}…).`;
        } catch (error) {
          // The withdraw landed: say so, and why the unwrap did not.
          done = `${done} The unwrap to USDC did not complete: ${describeTransactionError(error, connected.info.name)} The ${shown} wUSDC is in your public balance; unwrap it below.`;
        }
      }
      setOutcome({ busy: null, problem: null, done: `${done}${note}` });
      setAmount("");
      onDone?.();
    } catch (error) {
      setOutcome({
        busy: null,
        problem:
          error instanceof CryptoWorkerError && error.code === "insufficient_balance"
            ? "Your available confidential balance is below this amount. Nothing was sent."
            : describeTransactionError(error, connected?.info.name),
        done: null,
      });
    } finally {
      if (planId)
        await vault
          .worker()
          .endPlan(planId)
          .catch(() => undefined);
      release();
      await refresh();
    }
  }

  return (
    <form onSubmit={submit} noValidate data-testid="withdraw-form">
      <p className={styles.lead}>
        Moves wUSDC from your confidential available balance to your public balance, then, if you
        choose, unwraps it to USDC. The withdrawn amount is public onchain; your remaining balance
        stays confidential.
        {available !== null ? (
          <>
            {" "}
            Available now: <Amount>{formatTokenAmount(available, decimals)} wUSDC</Amount>.
          </>
        ) : null}
      </p>
      <label className={extra.field} htmlFor={`${id}-amount`}>
        Amount of wUSDC
        <span className={extra.amountRow}>
          <input
            id={`${id}-amount`}
            className={extra.input}
            inputMode="decimal"
            data-amount=""
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            aria-invalid={error ? true : undefined}
          />
        </span>
      </label>
      {error ? (
        <p className={styles.problem} role="alert">
          {error}
        </p>
      ) : null}
      <label className={extra.check}>
        <input
          type="checkbox"
          checked={unwrap}
          onChange={(event) => setUnwrap(event.target.checked)}
        />
        Also unwrap it to USDC
      </label>
      <div className={styles.actions}>
        <Button type="submit" variant="blue" disabled={!canRun || outcome.busy !== null}>
          {outcome.busy ? "Withdrawing…" : unwrap ? "Withdraw and unwrap" : "Withdraw"}
        </Button>
        {publicWusdc > 0n && network.usdcMint ? (
          <Button
            variant="line"
            disabled={!connected?.signer || outcome.busy !== null}
            onClick={() => void unwrapPublic(publicWusdc)}
          >
            Unwrap{" "}
            <Amount inControl>{formatTokenAmount(publicWusdc, decimals)} public wUSDC</Amount>
          </Button>
        ) : null}
      </div>
      <PausedNote />
      {!vault.unlocked ? (
        <p className={styles.lead} role="status">
          Unlock your keys first: the withdraw proofs are made in this tab.
        </p>
      ) : null}
      {outcome.busy ? (
        <div className={extra.progress} role="status" data-testid="withdraw-progress">
          <WithAmounts>{outcome.busy}</WithAmounts>
        </div>
      ) : null}
      {outcome.done ? (
        <div className={extra.result} role="status" data-testid="withdraw-done">
          <WithAmounts>{outcome.done}</WithAmounts>
        </div>
      ) : null}
      {outcome.problem ? (
        <p className={styles.problem} role="alert" data-testid="withdraw-problem">
          <WithAmounts>{outcome.problem}</WithAmounts>
        </p>
      ) : null}
    </form>
  );
}
