"use client";

// Step 4.11 (D-38): the two wallet signed actions that fill the confidential balance, for the
// "Get ready to pay" checklist and the pay form's fix buttons. `deposit` wraps the asset and deposits
// it into the pending balance (06 section 4, steps 1 and 2: one transaction when it fits the wallet's
// transaction version, two otherwise); `apply` applies the pending balance from fresh account state
// (step 3), with the keys unlocked in this tab. Each resolves with the last transaction's signature,
// or null with `problem` set. The Account setup page's funding card keeps its own flow.
import { formatTokenAmount, wrapAndDepositTransactions } from "@sotto/sdk/confidential/public";
import { sendWithWallet } from "@sotto/sdk/tx";
import { address, createNoopSigner, fetchEncodedAccount, type Instruction } from "@solana/kit";
import { useCallback, useState } from "react";
import { browserRpc } from "../../../../lib/client/rpc.ts";
import { describeTransactionError } from "../../../../lib/client/transactions.ts";
import { reportComparison } from "../../../../lib/client/wallet-report.ts";
import { useConfidential } from "./context.tsx";

export type FundingState = { busy: string | null; problem: string | null };

export function useFunding() {
  const { wallet, network, vault, data, connected, refresh } = useConfidential();
  const [state, setState] = useState<FundingState>({ busy: null, problem: null });
  const { symbol, wrappedSymbol } = network.asset;
  const decimals = network.decimals ?? 6;

  const send = useCallback(
    async (busy: string, build: () => Promise<readonly Instruction[]>): Promise<string | null> => {
      if (!connected?.signer) return null;
      setState({ busy, problem: null });
      const release = vault.hold();
      try {
        const sent = await sendWithWallet({
          rpc: browserRpc(),
          wallet: connected.signer,
          instructions: await build(),
          version: connected.version,
          onSignedMessage: (comparison) => reportComparison(connected.info, comparison),
        });
        await refresh();
        setState({ busy: null, problem: null });
        return sent.signature;
      } catch (error) {
        setState({
          busy: null,
          problem:
            error instanceof Error && error.name === "FundingStepError"
              ? error.message
              : describeTransactionError(error, connected.info.name),
        });
        await refresh();
        return null;
      } finally {
        release();
      }
    },
    [connected, vault, refresh],
  );

  /** Wraps `amount` of the asset and deposits it into the pending balance. */
  const deposit = useCallback(
    async (amount: bigint): Promise<string | null> => {
      if (!connected || !network.baseMint || !network.baseTokenProgram) return null;
      const shown = formatTokenAmount(amount, decimals);
      const plan = await wrapAndDepositTransactions({
        owner: createNoopSigner(address(wallet)),
        unwrappedMint: address(network.baseMint),
        unwrappedTokenProgram: address(network.baseTokenProgram),
        programAddress: address(network.tokenWrapProgram),
        amount,
        decimals,
        version: connected.version,
      });
      let last: string | null = null;
      for (const [index, instructions] of plan.transactions.entries()) {
        last = await send(
          plan.transactions.length === 1
            ? `Wrapping ${shown} ${symbol} and depositing it…`
            : `Moving ${shown} ${symbol}, transaction ${index + 1} of ${plan.transactions.length}…`,
          async () => instructions,
        );
        if (!last) return null;
      }
      return last;
    },
    [connected, network, wallet, decimals, symbol, send],
  );

  /** Applies the pending balance to the available balance. */
  const apply = useCallback(async (): Promise<string | null> => {
    const token = data.wusdcAccount;
    if (!token) return null;
    return send("Applying your pending balance…", async () => {
      const account = await fetchEncodedAccount(browserRpc(), address(token), {
        commitment: "confirmed",
      });
      if (!account.exists) {
        const missing = new Error(`Your ${wrappedSymbol} account does not exist.`);
        missing.name = "FundingStepError";
        throw missing;
      }
      return [await vault.worker().applyInstruction(token, new Uint8Array(account.data))];
    });
  }, [data.wusdcAccount, send, vault, wrappedSymbol]);

  const clear = useCallback(() => setState({ busy: null, problem: null }), []);

  return { ...state, deposit, apply, clear, canSend: Boolean(connected?.signer) };
}
