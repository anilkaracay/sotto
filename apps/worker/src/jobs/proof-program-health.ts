// proof-program-health (08 section 4, F-19 AC-19.1; step 1.9, because payment authorization needs a
// recent success). Every 5 minutes the job simulates a proof verification on the worker's cluster (a
// VerifyPubkeyValidity instruction with its proof inline, for a throwaway ElGamal keypair; nothing is
// signed or sent) and stores the result in `cluster_health`. The fee payer of the simulation is the
// worker's funded signer, because a simulation loads the fee payer. An RPC that cannot be reached is
// not a verdict on the program: the job logs it and stores nothing, so the last result ages out (the
// API accepts a success of at most 15 minutes). The banner of F-19 comes with step 2.8.
import { clusterHealth, type Database } from "@sotto/db";
import { clusterFromGenesisHash } from "@sotto/sdk/cluster";
import { checkProofProgram } from "@sotto/sdk/confidential";
import type { SolanaRpc } from "@sotto/sdk/tx";
import type { Address } from "@solana/kit";
import type { Job } from "./runner.ts";

export const PROOF_PROGRAM_HEALTH_INTERVAL_MS = 5 * 60_000;

export type ProofProgramHealthDeps = {
  db: Database;
  rpc: SolanaRpc;
  /** An existing funded account (the worker's signer) as the simulation's fee payer. */
  feePayer: Address;
  now?: () => Date;
  check?: typeof checkProofProgram;
};

export function proofProgramHealthJob(deps: ProofProgramHealthDeps): Job {
  const check = deps.check ?? checkProofProgram;
  return {
    name: "proof-program-health",
    intervalMs: PROOF_PROGRAM_HEALTH_INTERVAL_MS,
    run: async ({ log }) => {
      let cluster: "localnet" | "devnet" | "mainnet";
      let result;
      try {
        // Devnet and mainnet by genesis hash, anything else a local ledger (facts H6).
        const genesis = clusterFromGenesisHash(await deps.rpc.getGenesisHash().send());
        cluster = genesis === "other" ? "localnet" : genesis;
        result = await check(deps.rpc, deps.feePayer);
      } catch {
        log("proof_program_check_unreachable", {}, "warn");
        return { checked: false };
      }
      const checkedAt = deps.now?.() ?? new Date();
      const values = {
        proofProgramOk: result.ok,
        detail: result.ok ? null : result.reason.slice(0, 500),
        checkedAt,
      };
      await deps.db
        .insert(clusterHealth)
        .values({ cluster, ...values })
        .onConflictDoUpdate({ target: clusterHealth.cluster, set: values });
      if (!result.ok) log("proof_program_unavailable", { cluster }, "error");
      return { checked: true, cluster, ok: result.ok };
    },
  };
}
