"use client";

// One wallet signed transaction from an org page (06 section 9, step 1.7): the keys stay open while it
// runs (10 section 3), the transaction goes through the rules and the signed message check
// (sendWithWallet), every check that was not identical is reported with the wallet name, and the
// balances are read from chain again afterwards, whether it landed or not (AC-04.4).
import { sendWithWallet } from "@sotto/sdk/tx";
import type { Instruction } from "@solana/kit";
import { useCallback, useState } from "react";
import { browserRpc } from "../../../../lib/client/rpc.ts";
import { describeTransactionError } from "../../../../lib/client/transactions.ts";
import { reportComparison } from "../../../../lib/client/wallet-report.ts";
import { useConfidential } from "./context.tsx";

/** A step that failed after or around the transaction, with the words the page shows. */
export class StepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StepError";
  }
}

export type SendState = {
  busy: string | null;
  problem: string | null;
  done: { text: string; signature: string } | null;
};

export function useSend() {
  const { connected, vault, refresh } = useConfidential();
  const [state, setState] = useState<SendState>({ busy: null, problem: null, done: null });

  const send = useCallback(
    async (step: {
      /** What the page shows while it runs. */
      busy: string;
      /** What the page shows once it landed. */
      done: string;
      build: () => Promise<readonly Instruction[]>;
      /** Runs after the transaction landed and the balances were read again. */
      after?: () => Promise<void>;
    }): Promise<boolean> => {
      if (!connected?.signer) return false;
      setState({ busy: step.busy, problem: null, done: null });
      const release = vault.hold();
      try {
        const instructions = await step.build();
        const sent = await sendWithWallet({
          rpc: browserRpc(),
          wallet: connected.signer,
          instructions,
          version: connected.version,
          onSignedMessage: (comparison) => reportComparison(connected.info, comparison),
        });
        await refresh();
        await step.after?.();
        setState({
          busy: null,
          problem: null,
          done: { text: step.done, signature: sent.signature },
        });
        return true;
      } catch (error) {
        setState({
          busy: null,
          problem: error instanceof StepError ? error.message : describeTransactionError(error),
          done: null,
        });
        await refresh();
        return false;
      } finally {
        release();
      }
    },
    [connected, vault, refresh],
  );

  return { ...state, send, canSend: Boolean(connected?.signer) };
}
