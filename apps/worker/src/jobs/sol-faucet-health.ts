// sol-faucet-health (step 4.6, D-31; founder, 2026-10-09): watches the SOL faucet's wallet and tells the
// operator when it falls under 0.5 SOL, through the same notification as a new organization in review
// (SOTTO_NOTIFY_URL). One message when the balance goes under the line, and again each 24 hours while
// it stays there; nothing once it is funded. Devnet only: on any other ledger it reads nothing. The
// address and the balance are public onchain.
import { GENESIS_HASHES } from "@sotto/sdk/cluster";
import type { SolanaRpc } from "@sotto/sdk/tx";
import type { Address } from "@solana/kit";
import { sendNotification, type NotifyTarget } from "../notify.ts";
import type { Job } from "./runner.ts";

export const SOL_FAUCET_HEALTH_INTERVAL_MS = 5 * 60 * 1000;
/** The operator hears about it under 0.5 SOL: ten grants before the reserve is reached. */
export const SOL_FAUCET_ALERT_LAMPORTS = 500_000_000n;
const REPEAT_MS = 24 * 60 * 60 * 1000;

export type SolFaucetHealthDeps = {
  rpc: SolanaRpc;
  /** The faucet's wallet (SOL_FAUCET_KEYPAIR's address). */
  payer: Address;
  target: NotifyTarget | null;
  fetchFn?: typeof fetch;
  now?: () => Date;
  /** Only the tests pass their own ledger's; main.ts never sets it. */
  genesisHash?: string;
};

/** "0.42": lamports as SOL with two decimals, rounded down. */
const sol = (lamports: bigint) =>
  `${lamports / 1_000_000_000n}.${((lamports % 1_000_000_000n) / 10_000_000n).toString().padStart(2, "0")}`;

export function lowBalanceMessage(payer: string, lamports: bigint): string {
  return `Sotto: the SOL faucet's wallet ${payer} holds ${sol(lamports)} SOL, under ${sol(SOL_FAUCET_ALERT_LAMPORTS)} SOL. Send it devnet SOL so new wallets keep getting test SOL.`;
}

export function solFaucetHealthJob(deps: SolFaucetHealthDeps): Job {
  let devnet: boolean | null = null;
  let alertedAt: number | null = null;
  return {
    name: "sol-faucet-health",
    intervalMs: SOL_FAUCET_HEALTH_INTERVAL_MS,
    run: async ({ log }) => {
      devnet ??=
        (await deps.rpc.getGenesisHash().send()) === (deps.genesisHash ?? GENESIS_HASHES.devnet);
      if (!devnet) return { checked: false };
      const balance = (await deps.rpc.getBalance(deps.payer, { commitment: "confirmed" }).send())
        .value;
      if (balance >= SOL_FAUCET_ALERT_LAMPORTS) {
        alertedAt = null;
        return { checked: true, low: false };
      }
      const now = (deps.now?.() ?? new Date()).getTime();
      if (alertedAt !== null && now - alertedAt < REPEAT_MS) {
        return { checked: true, low: true, alerted: false };
      }
      log("sol_faucet_low_balance", { payer: deps.payer, lamports: balance.toString() }, "warn");
      if (!deps.target) {
        alertedAt = now;
        return { checked: true, low: true, alerted: false, skipped: true };
      }
      const result = await sendNotification(
        deps.target,
        lowBalanceMessage(deps.payer, balance),
        deps.fetchFn,
      );
      // A network error or a 5xx answer is tried again at the next run.
      if (result !== "failed") alertedAt = now;
      return { checked: true, low: true, alerted: result === "sent", service: deps.target.kind };
    },
  };
}
