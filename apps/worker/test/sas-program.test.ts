import { address } from "@solana/kit";
import { clusters } from "@sotto/sdk";
import { SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS } from "sas-lib";
import { describe, expect, it } from "vitest";
import {
  BUSINESS_SCHEMA_NAME,
  BUSINESS_SCHEMA_VERSION,
  SOTTO_CREDENTIAL_NAME,
} from "../src/sas/business-schema.ts";
import { deriveCredentialAddress, deriveSchemaAddress } from "../src/sas/sas-lib-boundary.ts";

/** Devnet SAS signer (Phase 1 kickoff), the authority and only authorized signer of the credential. */
const DEVNET_SAS_SIGNER = address("CE2yDeympDQmYYM29eSth9i8XBN48nGPqodFg2ggxXqe");

describe("SAS values in the sdk cluster config", () => {
  it("the program ID equals the sas-lib constant (D-24, facts E3)", () => {
    const devnet = clusters.devnet;
    if (!devnet.available) throw new Error("devnet must be available");
    expect(devnet.programs.sas).toBe(String(SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS));
  });

  it("the devnet credential and schema are the PDAs of the devnet SAS signer (facts E7)", async () => {
    const devnet = clusters.devnet;
    if (!devnet.available) throw new Error("devnet must be available");
    const credential = await deriveCredentialAddress(DEVNET_SAS_SIGNER, SOTTO_CREDENTIAL_NAME);
    expect(devnet.sasCredential).toBe(credential);
    expect(devnet.sasBusinessSchema).toBe(
      await deriveSchemaAddress(credential, BUSINESS_SCHEMA_NAME, BUSINESS_SCHEMA_VERSION),
    );
  });
});
