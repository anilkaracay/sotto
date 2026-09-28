// Proof program availability (F-19, AC-19.1; step 1.9, which gates payment authorization on it): does
// the ZK ElGamal Proof program verify proofs on this cluster? A VerifyPubkeyValidity instruction with
// its proof inline, for a throwaway ElGamal keypair, in a simulated transaction (no signature check,
// nothing written, no fee charged). Success means the program is active and verifying; an error
// means it is not (facts B5: a feature gate can disable it). The fee payer must be an existing funded
// account, because the simulation loads it.
import { verifyPubkeyValidity } from "@solana-program/zk-elgamal-proof";
import {
  createNoopSigner,
  type Address,
  type GetMinimumBalanceForRentExemptionApi,
  type Rpc,
} from "@solana/kit";
import { ElGamalKeypair, PubkeyValidityProofData } from "@solana/zk-sdk/bundler";
import type { SolanaRpc } from "../tx/rpc.ts";
import { simulateInstructions } from "../tx/simulate.ts";

export type ProofProgramCheck = { ok: true } | { ok: false; reason: string };

/** Inline proofs create no account, so the builder reads no rent; anything else fails loudly. */
const NO_RPC = {
  getMinimumBalanceForRentExemption() {
    throw new Error("an inline proof makes no RPC calls");
  },
} as unknown as Rpc<GetMinimumBalanceForRentExemptionApi>;

export async function checkProofProgram(
  rpc: SolanaRpc,
  feePayer: Address,
): Promise<ProofProgramCheck> {
  const keypair = new ElGamalKeypair();
  const proof = new PubkeyValidityProofData(keypair);
  let instructions;
  try {
    instructions = await verifyPubkeyValidity({
      rpc: NO_RPC,
      payer: createNoopSigner(feePayer),
      proofData: proof.toBytes(),
    });
  } finally {
    proof.free();
    keypair.free();
  }
  const result = await simulateInstructions({ rpc, feePayer, instructions });
  if (result.err === null) return { ok: true };
  return {
    ok: false,
    reason: JSON.stringify(result.err, (_, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  };
}
