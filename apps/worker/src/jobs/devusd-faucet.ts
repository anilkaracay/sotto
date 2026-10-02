// devusd-faucet (step 4.3, D-29; founder, 2026-10-02): mints the devUSD that owners asked the web's
// faucet for (apps/web/lib/server/faucet.ts) into their wallets' associated devUSD accounts, signed
// by the devUSD mint authority, which only this worker holds. Devnet only: before minting anything it
// checks that its RPC serves devnet's genesis hash and that the devUSD mint's authority is its signer;
// on any other ledger it mints nothing and fails the requests. Each mint is signed, its signature and
// last valid block height stored, and only then sent, so a restart never mints a request twice: a
// stored signature is followed until it finalizes or its blockhash expires (then the request is sent
// again under a new one). Runs every 3 seconds.
import { faucetMints, type Database } from "@sotto/db";
import { GENESIS_HASHES } from "@sotto/sdk/cluster";
import { decodeTransactionError, prepareTransaction, type SolanaRpc } from "@sotto/sdk/tx";
import {
  fetchMint,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getMintToCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  address,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  signTransactionMessageWithSigners,
  type Address,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit";
import { asc, eq, inArray } from "drizzle-orm";
import type { Job } from "./runner.ts";

export const DEVUSD_FAUCET_INTERVAL_MS = 3_000;
const BATCH = 5;
const DECIMALS = 6;

export type DevusdFaucetDeps = {
  db: Database;
  rpc: SolanaRpc;
  /** The devUSD mint authority (DEVUSD_MINT_AUTHORITY_KEYPAIR), also the fee payer. */
  authority: KeyPairSigner;
  /** The devUSD SPL Token mint of the devnet registry. */
  mint: Address;
  /**
   * The ledger it may mint on, devnet's. Only the localnet tests pass their own ledger's, to exercise
   * the minting; main.ts never sets it.
   */
  genesisHash?: string;
};

type Readiness = { ok: true } | { ok: false; code: "wrong_cluster" | "wrong_authority" };

/** Whether this worker may mint: devnet's ledger, and the mint's authority is the signer. */
async function readiness(deps: DevusdFaucetDeps): Promise<Readiness> {
  if ((await deps.rpc.getGenesisHash().send()) !== (deps.genesisHash ?? GENESIS_HASHES.devnet)) {
    return { ok: false, code: "wrong_cluster" };
  }
  const mint = await fetchMint(deps.rpc, deps.mint, { commitment: "finalized" });
  const authority = mint.data.mintAuthority;
  if (authority.__option !== "Some" || authority.value !== deps.authority.address) {
    return { ok: false, code: "wrong_authority" };
  }
  return { ok: true };
}

export function devusdFaucetJob(deps: DevusdFaucetDeps): Job {
  let ready: Readiness | null = null;
  const set = (id: string, values: Partial<typeof faucetMints.$inferInsert>) =>
    deps.db
      .update(faucetMints)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(faucetMints.id, id));

  return {
    name: "devusd-faucet",
    intervalMs: DEVUSD_FAUCET_INTERVAL_MS,
    run: async ({ log }) => {
      const open = await deps.db
        .select()
        .from(faucetMints)
        .where(inArray(faucetMints.status, ["pending", "sent"]))
        .orderBy(asc(faucetMints.createdAt))
        .limit(BATCH);
      if (open.length === 0) return { minted: 0, sent: 0, failed: 0 };

      // Checked once per process: the ledger and the mint authority do not change under it.
      ready ??= await readiness(deps);
      if (!ready.ok) {
        const code = ready.code;
        for (const row of open) await set(row.id, { status: "failed", errorCode: code });
        log("faucet_refused", { reason: code, requests: open.length }, "error");
        return { minted: 0, sent: 0, failed: open.length };
      }

      let minted = 0;
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
              "faucet_failed",
              { mintId: row.id, signature, error: decodeTransactionError(status.err).message },
              "warn",
            );
            failed += 1;
          } else if (status?.confirmationStatus === "finalized") {
            await set(row.id, { status: "minted" });
            log("faucet_minted", { mintId: row.id, wallet: row.wallet, signature });
            minted += 1;
          } else if (!status) {
            const height = await deps.rpc.getBlockHeight({ commitment: "finalized" }).send();
            // The blockhash expired before the transaction landed: send it again under a new one.
            if (row.lastValidBlockHeight !== null && height > row.lastValidBlockHeight) {
              await set(row.id, { status: "pending", signature: null, lastValidBlockHeight: null });
            }
          }
          continue;
        }

        const wallet = address(row.wallet);
        const [account] = await findAssociatedTokenPda({
          owner: wallet,
          mint: deps.mint,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        const lifetime = (await deps.rpc.getLatestBlockhash({ commitment: "confirmed" }).send())
          .value;
        let message;
        try {
          ({ message } = await prepareTransaction({
            rpc: deps.rpc,
            version: 0,
            feePayer: deps.authority,
            lifetime,
            instructions: [
              getCreateAssociatedTokenIdempotentInstruction({
                payer: deps.authority,
                ata: account,
                owner: wallet,
                mint: deps.mint,
              }),
              getMintToCheckedInstruction({
                mint: deps.mint,
                token: account,
                mintAuthority: deps.authority,
                amount: row.amountBaseUnits,
                decimals: DECIMALS,
              }),
            ],
          }));
        } catch (error) {
          // The simulation refused it: sending would fail too.
          await set(row.id, { status: "failed", errorCode: "simulation_failed" });
          log("faucet_failed", { mintId: row.id, error }, "warn");
          failed += 1;
          continue;
        }
        const signed = await signTransactionMessageWithSigners(message);
        const signature = getSignatureFromTransaction(signed);
        // Stored before it is sent: a restart follows this signature instead of minting again.
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
        log("faucet_sent", { mintId: row.id, wallet: row.wallet, signature });
        sent += 1;
      }
      return { minted, sent, failed };
    },
  };
}
