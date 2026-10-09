// sol-faucet (step 4.6, D-31): sends the devnet SOL that signed in wallets asked the web's faucet for
// (apps/web/lib/server/sol-faucet.ts), a plain System Program transfer from the faucet's own wallet.
// Devnet only: before sending anything it checks that its RPC serves devnet's genesis hash; on any
// other ledger it sends nothing and fails the requests. It never takes its wallet below the reserve
// that the wallet's other work needs (the devUSD faucet's fees and account rent): a grant it cannot
// afford fails, which counts toward no limit, and is logged for the operator. Each transfer is
// signed, its signature and last valid block height stored, and only then sent, so a restart never
// pays a request twice: a stored signature is followed until it finalizes or its blockhash expires
// (then the request is sent again under a new one). Runs every 3 seconds.
import { solGrants, type Database } from "@sotto/db";
import { GENESIS_HASHES } from "@sotto/sdk/cluster";
import { decodeTransactionError, prepareTransaction, type SolanaRpc } from "@sotto/sdk/tx";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  address,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  signTransactionMessageWithSigners,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit";
import { asc, eq, inArray } from "drizzle-orm";
import type { Job } from "./runner.ts";

export const SOL_FAUCET_INTERVAL_MS = 3_000;
const BATCH = 5;
/** What stays in the paying wallet whatever is asked: 0.1 SOL. */
export const SOL_FAUCET_RESERVE_LAMPORTS = 100_000_000n;

export type SolFaucetDeps = {
  db: Database;
  rpc: SolanaRpc;
  /** The wallet the grants come from, also the fee payer. */
  payer: KeyPairSigner;
  /**
   * The ledger it may send on, devnet's. Only the localnet tests pass their own ledger's, to exercise
   * the sending; main.ts never sets it.
   */
  genesisHash?: string;
};

export function solFaucetJob(deps: SolFaucetDeps): Job {
  let devnet: boolean | null = null;
  const set = (id: string, values: Partial<typeof solGrants.$inferInsert>) =>
    deps.db
      .update(solGrants)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(solGrants.id, id));

  return {
    name: "sol-faucet",
    intervalMs: SOL_FAUCET_INTERVAL_MS,
    run: async ({ log }) => {
      const open = await deps.db
        .select()
        .from(solGrants)
        .where(inArray(solGrants.status, ["pending", "sent"]))
        .orderBy(asc(solGrants.createdAt))
        .limit(BATCH);
      if (open.length === 0) return { paid: 0, sent: 0, failed: 0 };

      // Checked once per process: the ledger does not change under it.
      devnet ??=
        (await deps.rpc.getGenesisHash().send()) === (deps.genesisHash ?? GENESIS_HASHES.devnet);
      if (!devnet) {
        for (const row of open) await set(row.id, { status: "failed", errorCode: "wrong_cluster" });
        log("sol_faucet_refused", { reason: "wrong_cluster", requests: open.length }, "error");
        return { paid: 0, sent: 0, failed: open.length };
      }

      let paid = 0;
      let sent = 0;
      let failed = 0;
      for (const row of open) {
        if (row.status === "sent" && row.signature) {
          const signature = row.signature as Signature;
          const { value } = await deps.rpc.getSignatureStatuses([signature]).send();
          const status = value[0];
          if (status?.err) {
            await set(row.id, { status: "failed", errorCode: "transaction_failed" });
            log(
              "sol_faucet_failed",
              { grantId: row.id, signature, error: decodeTransactionError(status.err).message },
              "warn",
            );
            failed += 1;
          } else if (status?.confirmationStatus === "finalized") {
            await set(row.id, { status: "paid" });
            log("sol_faucet_paid", { grantId: row.id, wallet: row.wallet, signature });
            paid += 1;
          } else if (!status) {
            const height = await deps.rpc.getBlockHeight({ commitment: "finalized" }).send();
            // The blockhash expired before the transaction landed: send it again under a new one.
            if (row.lastValidBlockHeight !== null && height > row.lastValidBlockHeight) {
              await set(row.id, { status: "pending", signature: null, lastValidBlockHeight: null });
            }
          }
          continue;
        }

        const balance = (
          await deps.rpc.getBalance(deps.payer.address, { commitment: "confirmed" }).send()
        ).value;
        if (balance < row.lamports + SOL_FAUCET_RESERVE_LAMPORTS) {
          await set(row.id, { status: "failed", errorCode: "faucet_low" });
          // For the operator: the faucet's wallet needs SOL. The balance is public onchain.
          log("sol_faucet_low", { grantId: row.id, payer: deps.payer.address }, "error");
          failed += 1;
          continue;
        }
        const lifetime = (await deps.rpc.getLatestBlockhash({ commitment: "confirmed" }).send())
          .value;
        let message;
        try {
          ({ message } = await prepareTransaction({
            rpc: deps.rpc,
            version: 0,
            feePayer: deps.payer,
            lifetime,
            instructions: [
              getTransferSolInstruction({
                source: deps.payer,
                destination: address(row.wallet),
                amount: row.lamports,
              }),
            ],
          }));
        } catch (error) {
          // The simulation refused it: sending would fail too.
          await set(row.id, { status: "failed", errorCode: "simulation_failed" });
          log("sol_faucet_failed", { grantId: row.id, error }, "warn");
          failed += 1;
          continue;
        }
        const signed = await signTransactionMessageWithSigners(message);
        const signature = getSignatureFromTransaction(signed);
        // Stored before it is sent: a restart follows this signature instead of paying again.
        await set(row.id, {
          status: "sent",
          signature,
          lastValidBlockHeight: lifetime.lastValidBlockHeight,
        });
        await deps.rpc
          .sendTransaction(getBase64EncodedWireTransaction(signed), {
            encoding: "base64",
            preflightCommitment: "confirmed",
          })
          .send();
        log("sol_faucet_sent", { grantId: row.id, wallet: row.wallet, signature });
        sent += 1;
      }
      return { paid, sent, failed };
    },
  };
}
