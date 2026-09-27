// SAS operations for the worker (08 sections 4 and 5): the Sotto credential, the sotto.business.v1
// schema and business attestations. Accounts are read with kit 8 and decoded through the sas-lib
// boundary, and every account must be owned by the SAS program. Writes are signed by the SAS signer
// and sent with sendWithKeypairSigners (06 section 9). The SAS signer is the credential authority,
// its only authorized signer and the payer.
import {
  getAddressEncoder,
  getBase64Encoder,
  getProgramDerivedAddress,
  type Address,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit";
import {
  sendWithKeypairSigners,
  simulateInstructions,
  type SimulationResult,
  type SolanaRpc,
} from "@sotto/sdk/tx";
import {
  BUSINESS_SCHEMA_DESCRIPTION,
  BUSINESS_SCHEMA_FIELD_NAMES,
  BUSINESS_SCHEMA_LAYOUT,
  BUSINESS_SCHEMA_NAME,
  BUSINESS_SCHEMA_VERSION,
  SOTTO_CREDENTIAL_NAME,
  type BusinessAttestation,
} from "./business-schema.ts";
import {
  closeAttestationInstruction,
  createAttestationInstruction,
  createCredentialInstruction,
  createSchemaInstruction,
  decodeAttestationAccount,
  decodeAttestationData,
  decodeCredentialAccount,
  decodeSchemaAccount,
  deriveAttestationAddress,
  deriveCredentialAddress,
  deriveSchemaAddress,
  encodeAttestationData,
  SAS_PROGRAM_ADDRESS,
  type AttestationAccount,
  type CredentialAccount,
  type SchemaAccount,
} from "./sas-lib-boundary.ts";

export type SasContext = { rpc: SolanaRpc; signer: KeyPairSigner };

/** SAS custom program errors by code (SAS program error.rs). */
export const SAS_ERROR_NAMES = [
  "InvalidCredential",
  "InvalidSchema",
  "InvalidAttestation",
  "InvalidAuthority",
  "InvalidSchemaDataType",
  "SignerNotAuthorized",
  "InvalidAttestationData",
  "InvalidEventAuthority",
  "InvalidMint",
  "InvalidProgramSigner",
  "InvalidTokenAccount",
  "SchemaPaused",
] as const;

/** create_attestation.rs returns InvalidAttestation when the account is not the expected PDA. */
export const SAS_INVALID_ATTESTATION = 2;

/** The custom error code of a failed instruction (`{ InstructionError: [index, { Custom }] }`). */
export function customErrorCode(err: unknown): number | null {
  if (typeof err !== "object" || err === null || !("InstructionError" in err)) return null;
  const detail = (err as { InstructionError: unknown }).InstructionError;
  if (!Array.isArray(detail)) return null;
  const custom = (detail[1] as { Custom?: unknown } | undefined)?.Custom;
  return typeof custom === "bigint" || typeof custom === "number" ? Number(custom) : null;
}

export type Ensured<T> = { address: Address; account: T; signature: Signature | null };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Account bytes, or null when the account does not exist. Throws unless SAS owns the account. */
export async function fetchSasAccount(
  rpc: SolanaRpc,
  address: Address,
): Promise<Uint8Array | null> {
  const { value } = await rpc
    .getAccountInfo(address, { encoding: "base64", commitment: "confirmed" })
    .send();
  if (!value) return null;
  if (value.owner !== SAS_PROGRAM_ADDRESS) {
    throw new Error(`account ${address} is not owned by the SAS program`);
  }
  return new Uint8Array(getBase64Encoder().encode(value.data[0]));
}

/** Reads an account written by a transaction that just confirmed, allowing for RPC node lag. */
async function fetchAfterWrite(rpc: SolanaRpc, address: Address): Promise<Uint8Array> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const bytes = await fetchSasAccount(rpc, address);
    if (bytes) return bytes;
    await sleep(1000);
  }
  throw new Error(`account ${address} was not found after its transaction confirmed`);
}

async function send(
  ctx: SasContext,
  instruction: Parameters<typeof sendWithKeypairSigners>[0]["instructions"][number],
) {
  const { signature } = await sendWithKeypairSigners({
    rpc: ctx.rpc,
    feePayer: ctx.signer,
    instructions: [instruction],
  });
  return signature;
}

/** The Sotto credential of this signer, created when missing. */
export async function ensureCredential(ctx: SasContext): Promise<Ensured<CredentialAccount>> {
  const { rpc, signer } = ctx;
  const address = await deriveCredentialAddress(signer.address, SOTTO_CREDENTIAL_NAME);
  let bytes = await fetchSasAccount(rpc, address);
  let signature: Signature | null = null;
  if (!bytes) {
    signature = await send(
      ctx,
      createCredentialInstruction({
        payer: signer,
        authority: signer,
        credential: address,
        name: SOTTO_CREDENTIAL_NAME,
        signers: [signer.address],
      }),
    );
    bytes = await fetchAfterWrite(rpc, address);
  }
  const account = decodeCredentialAccount(bytes);
  if (account.authority !== signer.address || account.name !== SOTTO_CREDENTIAL_NAME) {
    throw new Error(`credential ${address} does not belong to ${signer.address}`);
  }
  if (!account.authorizedSigners.includes(signer.address)) {
    throw new Error(`${signer.address} is not an authorized signer of credential ${address}`);
  }
  return { address, account, signature };
}

export function assertBusinessSchema(schema: SchemaAccount, credential: Address): void {
  const problems: string[] = [];
  if (schema.credential !== credential) problems.push("credential");
  if (schema.name !== BUSINESS_SCHEMA_NAME) problems.push("name");
  if (schema.version !== BUSINESS_SCHEMA_VERSION) problems.push("version");
  if (schema.isPaused) problems.push("paused");
  if (schema.layout.join(",") !== BUSINESS_SCHEMA_LAYOUT.join(",")) problems.push("layout");
  if (schema.fieldNames.join(",") !== BUSINESS_SCHEMA_FIELD_NAMES.join(",")) {
    problems.push("field names");
  }
  if (problems.length > 0) {
    throw new Error(`schema does not match ${BUSINESS_SCHEMA_NAME}: ${problems.join(", ")}`);
  }
}

/** The sotto.business.v1 schema under the credential, created when missing. */
export async function ensureBusinessSchema(
  ctx: SasContext,
  credential: Address,
): Promise<Ensured<SchemaAccount>> {
  const { rpc, signer } = ctx;
  const address = await deriveSchemaAddress(
    credential,
    BUSINESS_SCHEMA_NAME,
    BUSINESS_SCHEMA_VERSION,
  );
  let bytes = await fetchSasAccount(rpc, address);
  let signature: Signature | null = null;
  if (!bytes) {
    signature = await send(
      ctx,
      createSchemaInstruction({
        payer: signer,
        authority: signer,
        credential,
        schema: address,
        name: BUSINESS_SCHEMA_NAME,
        description: BUSINESS_SCHEMA_DESCRIPTION,
        layout: BUSINESS_SCHEMA_LAYOUT,
        fieldNames: BUSINESS_SCHEMA_FIELD_NAMES,
      }),
    );
    bytes = await fetchAfterWrite(rpc, address);
  }
  const account = decodeSchemaAccount(bytes);
  assertBusinessSchema(account, credential);
  return { address, account, signature };
}

export type BusinessAttestationInput = {
  credential: Address;
  schema: Ensured<SchemaAccount>;
  /** The org owner's wallet: the attestation nonce (08 section 5). */
  owner: Address;
  data: BusinessAttestation;
  expiry: bigint;
};

function attestationInstruction(
  ctx: SasContext,
  input: BusinessAttestationInput,
  attestation: Address,
) {
  return createAttestationInstruction({
    payer: ctx.signer,
    authority: ctx.signer,
    credential: input.credential,
    schema: input.schema.address,
    attestation,
    nonce: input.owner,
    data: encodeAttestationData(input.schema.account, input.data),
    expiry: input.expiry,
  });
}

export async function issueBusinessAttestation(
  ctx: SasContext,
  input: BusinessAttestationInput,
): Promise<{ address: Address; signature: Signature }> {
  const address = await deriveAttestationAddress(
    input.credential,
    input.schema.address,
    input.owner,
  );
  if (await fetchSasAccount(ctx.rpc, address)) {
    throw new Error(`an attestation for ${input.owner} already exists at ${address}`);
  }
  const signature = await send(ctx, attestationInstruction(ctx, input, address));
  await fetchAfterWrite(ctx.rpc, address);
  return { address, signature };
}

function toBusinessAttestation(raw: Record<string, unknown>): BusinessAttestation {
  const { org_id, legal_name, country, verified_at, level } = raw;
  if (
    typeof org_id !== "string" ||
    typeof legal_name !== "string" ||
    typeof country !== "string" ||
    (typeof verified_at !== "bigint" && typeof verified_at !== "number") ||
    typeof level !== "number"
  ) {
    throw new Error(`attestation data does not match ${BUSINESS_SCHEMA_NAME}`);
  }
  return { org_id, legal_name, country, verified_at: BigInt(verified_at), level };
}

export async function readBusinessAttestation(
  rpc: SolanaRpc,
  address: Address,
  schema: SchemaAccount,
): Promise<{ account: AttestationAccount; data: BusinessAttestation } | null> {
  const bytes = await fetchSasAccount(rpc, address);
  if (!bytes) return null;
  const account = decodeAttestationAccount(bytes);
  return { account, data: toBusinessAttestation(decodeAttestationData(schema, account.data)) };
}

export async function closeAttestation(
  ctx: SasContext,
  input: { credential: Address; attestation: Address },
): Promise<Signature> {
  const signature = await send(
    ctx,
    closeAttestationInstruction({
      payer: ctx.signer,
      authority: ctx.signer,
      credential: input.credential,
      attestation: input.attestation,
    }),
  );
  for (let attempt = 0; attempt < 10; attempt++) {
    const { value } = await ctx.rpc
      .getAccountInfo(input.attestation, { encoding: "base64", commitment: "confirmed" })
      .send();
    if (!value || value.owner !== SAS_PROGRAM_ADDRESS) return signature;
    await sleep(1000);
  }
  throw new Error(`attestation ${input.attestation} still exists after its close confirmed`);
}

export type DerivationCheck = {
  /** sas-lib deriveAttestationPda. */
  sasLib: Address;
  /** Seeds ["attestation", credential, schema, nonce] under the SAS program, derived with kit 8. */
  independent: Address;
  /** The address derived for another nonce (the credential address), which SAS must reject. */
  wrongAddress: Address;
  wrongAddressSimulation: SimulationResult;
  /** True when that create failed with InvalidAttestation, the program's PDA check. */
  wrongAddressRejectedByPdaCheck: boolean;
};

/**
 * G5 (08 section 5): SAS must derive the attestation address from credential, schema and nonce.
 * Compares two derivations and simulates (never sends) a create at an address derived for another
 * nonce, which the program must reject.
 */
export async function checkAttestationDerivation(
  ctx: SasContext,
  input: BusinessAttestationInput,
): Promise<DerivationCheck> {
  const sasLib = await deriveAttestationAddress(
    input.credential,
    input.schema.address,
    input.owner,
  );
  const encoder = getAddressEncoder();
  const [independent] = await getProgramDerivedAddress({
    programAddress: SAS_PROGRAM_ADDRESS,
    seeds: [
      "attestation",
      encoder.encode(input.credential),
      encoder.encode(input.schema.address),
      encoder.encode(input.owner),
    ],
  });
  const wrongAddress = await deriveAttestationAddress(
    input.credential,
    input.schema.address,
    input.credential,
  );
  const wrongAddressSimulation = await simulateInstructions({
    rpc: ctx.rpc,
    feePayer: ctx.signer.address,
    instructions: [attestationInstruction(ctx, input, wrongAddress)],
  });
  return {
    sasLib,
    independent,
    wrongAddress,
    wrongAddressSimulation,
    wrongAddressRejectedByPdaCheck:
      customErrorCode(wrongAddressSimulation.err) === SAS_INVALID_ATTESTATION,
  };
}
