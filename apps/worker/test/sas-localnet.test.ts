// The G5 flow against a local validator with SAS cloned from devnet (scripts/localnet.sh). Skipped
// unless SOTTO_LOCALNET_RPC_URL is set; scripts/ci-local.sh runs it in the localnet job. Uses a
// throwaway signer funded by airdrop.
import { generateKeyPairSigner, lamports } from "@solana/kit";
import { clusterFromGenesisHash } from "@sotto/sdk/cluster";
import { createRetryingRpc, waitForConfirmation } from "@sotto/sdk/tx";
import { describe, expect, it } from "vitest";
import { attestationExpiry, LEVEL_MANUAL_REVIEW } from "../src/sas/business-schema.ts";
import {
  checkAttestationDerivation,
  closeAttestation,
  ensureBusinessSchema,
  ensureCredential,
  fetchSasAccount,
  issueBusinessAttestation,
  readBusinessAttestation,
} from "../src/sas/client.ts";
import { SAS_ACCOUNT_DISCRIMINATOR } from "../src/sas/sas-lib-boundary.ts";

const RPC_URL = process.env.SOTTO_LOCALNET_RPC_URL;

describe.skipIf(!RPC_URL)("SAS on localnet (G5 flow)", () => {
  it(
    "creates the credential and schema once, then issues, reads and closes an attestation",
    { timeout: 180_000 },
    async () => {
      const rpc = createRetryingRpc(RPC_URL as string);
      expect(clusterFromGenesisHash(await rpc.getGenesisHash().send())).toBe("other");
      const signer = await generateKeyPairSigner();
      await waitForConfirmation(
        rpc,
        await rpc.requestAirdrop(signer.address, lamports(2_000_000_000n)).send(),
      );
      const ctx = { rpc, signer };

      const credential = await ensureCredential(ctx);
      expect(credential.signature).not.toBeNull();
      expect(credential.account.authorizedSigners).toEqual([signer.address]);
      const credentialAgain = await ensureCredential(ctx);
      expect(credentialAgain).toMatchObject({ address: credential.address, signature: null });

      const schema = await ensureBusinessSchema(ctx, credential.address);
      expect(schema.signature).not.toBeNull();
      expect(schema.account.layout).toEqual([12, 12, 12, 8, 0]);
      expect(schema.account.fieldNames).toEqual([
        "org_id",
        "legal_name",
        "country",
        "verified_at",
        "level",
      ]);
      expect(schema.account.version).toBe(1);
      expect(await ensureBusinessSchema(ctx, credential.address)).toMatchObject({
        signature: null,
      });

      // Account discriminators as the deployed program writes them (SAS state/discriminator.rs).
      expect((await fetchSasAccount(rpc, credential.address))?.[0]).toBe(
        SAS_ACCOUNT_DISCRIMINATOR.credential,
      );
      expect((await fetchSasAccount(rpc, schema.address))?.[0]).toBe(
        SAS_ACCOUNT_DISCRIMINATOR.schema,
      );

      const owner = (await generateKeyPairSigner()).address;
      const now = BigInt(Math.floor(Date.now() / 1000));
      const input = {
        credential: credential.address,
        schema,
        owner,
        data: {
          org_id: "localnet-test",
          legal_name: "Localnet test business",
          country: "ZZ",
          verified_at: now,
          level: LEVEL_MANUAL_REVIEW,
        },
        expiry: attestationExpiry(now),
      };

      const derivation = await checkAttestationDerivation(ctx, input);
      expect(derivation.independent).toBe(derivation.sasLib);
      expect(derivation.wrongAddressSimulation.err).not.toBeNull();
      expect(derivation.wrongAddressRejectedByPdaCheck).toBe(true);

      const issued = await issueBusinessAttestation(ctx, input);
      expect(issued.address).toBe(derivation.sasLib);
      expect((await fetchSasAccount(rpc, issued.address))?.[0]).toBe(
        SAS_ACCOUNT_DISCRIMINATOR.attestation,
      );
      await expect(issueBusinessAttestation(ctx, input)).rejects.toThrow("already exists");

      const read = await readBusinessAttestation(rpc, issued.address, schema.account);
      expect(read?.account).toMatchObject({
        nonce: owner,
        credential: credential.address,
        schema: schema.address,
        signer: signer.address,
        expiry: input.expiry,
      });
      expect(read?.data).toEqual(input.data);

      const before = (await rpc.getBalance(signer.address, { commitment: "confirmed" }).send())
        .value;
      await closeAttestation(ctx, { credential: credential.address, attestation: issued.address });
      expect(await fetchSasAccount(rpc, issued.address)).toBeNull();
      const after = (await rpc.getBalance(signer.address, { commitment: "confirmed" }).send())
        .value;
      expect(after).toBeGreaterThan(before); // the rent returns to the payer (close_attestation.rs)
    },
  );
});
