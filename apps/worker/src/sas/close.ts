// Closing an owner wallet's Sotto attestation (step 1.6, scripts/sas-close-attestation.ts; Phase 4
// demo seeding needs it): devnet only. On devnet the SAS signer is the credential authority and its
// authorized signer (08 section 5), so it can close the attestation, and the rent returns to it.
import { GENESIS_HASHES } from "@sotto/sdk/cluster";
import type { SolanaRpc } from "@sotto/sdk/tx";
import type { Address, Signature } from "@solana/kit";
import { closeAttestation, sasAccountExists, type SasContext } from "./client.ts";
import { deriveAttestationAddress } from "./sas-lib-boundary.ts";

/** Refuses mainnet and every RPC endpoint whose genesis hash is not devnet's (facts H6). */
export function assertDevnet(genesisHash: string): void {
  if (genesisHash === GENESIS_HASHES.mainnet) {
    throw new Error("the RPC endpoint serves mainnet; refused (D-01)");
  }
  if (genesisHash !== GENESIS_HASHES.devnet) {
    throw new Error(`the RPC endpoint does not serve devnet (genesis ${genesisHash}); refused`);
  }
}

export type OwnerAttestation = { credential: Address; schema: Address; owner: Address };

/** The attestation address of an owner wallet (nonce = owner wallet) and whether it exists. */
export async function findOwnerAttestation(
  rpc: SolanaRpc,
  input: OwnerAttestation,
): Promise<{ attestation: Address; exists: boolean }> {
  const attestation = await deriveAttestationAddress(input.credential, input.schema, input.owner);
  return { attestation, exists: await sasAccountExists(rpc, attestation) };
}

/** Closes the owner's attestation; a missing attestation is left alone (signature null). */
export async function closeOwnerAttestation(
  ctx: SasContext,
  input: OwnerAttestation,
): Promise<{ attestation: Address; signature: Signature | null }> {
  const found = await findOwnerAttestation(ctx.rpc, input);
  if (!found.exists) return { attestation: found.attestation, signature: null };
  const signature = await closeAttestation(ctx, {
    credential: input.credential,
    attestation: found.attestation,
  });
  return { attestation: found.attestation, signature };
}
