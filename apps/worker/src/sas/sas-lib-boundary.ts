// The only worker module that imports sas-lib (D-24). sas-lib 1.0.10 is built on @solana/kit 5 while
// the worker uses @solana/kit 8. Both represent an address as its base58 string and an instruction
// as a plain object whose account metas use the same AccountRole numbers and carry the signer object,
// so crossing the boundary is a type cast. test/sas-boundary.test.ts checks that at runtime (D-24:
// G5 tests the conversion).
import {
  deriveAttestationPda,
  deriveCredentialPda,
  deriveEventAuthorityAddress,
  deriveSchemaPda,
  deserializeAttestationData,
  getAttestationDecoder,
  getCloseAttestationInstruction,
  getCreateAttestationInstruction,
  getCreateCredentialInstruction,
  getCreateSchemaInstruction,
  getCredentialDecoder,
  getSchemaDecoder,
  serializeAttestationData,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
  type Schema as SasSchema,
} from "sas-lib";
import type { Address, Instruction, KeyPairSigner } from "@solana/kit";

type SasAddress = Parameters<typeof deriveCredentialPda>[0]["authority"];
type SasSigner = Parameters<typeof getCreateCredentialInstruction>[0]["payer"];

const toSas = (value: Address): SasAddress => value as unknown as SasAddress;
const fromSas = (value: SasAddress): Address => value as unknown as Address;
const toSasSigner = (signer: KeyPairSigner): SasSigner => signer as unknown as SasSigner;
const fromSasInstruction = (instruction: object): Instruction => instruction as Instruction;

export const SAS_PROGRAM_ADDRESS: Address = fromSas(SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS);

/** First byte of every SAS account (SAS program state/discriminator.rs). */
export const SAS_ACCOUNT_DISCRIMINATOR = { credential: 0, schema: 1, attestation: 2 } as const;

export async function deriveCredentialAddress(authority: Address, name: string): Promise<Address> {
  const [pda] = await deriveCredentialPda({ authority: toSas(authority), name });
  return fromSas(pda);
}

export async function deriveSchemaAddress(
  credential: Address,
  name: string,
  version: number,
): Promise<Address> {
  const [pda] = await deriveSchemaPda({ credential: toSas(credential), name, version });
  return fromSas(pda);
}

export async function deriveAttestationAddress(
  credential: Address,
  schema: Address,
  nonce: Address,
): Promise<Address> {
  const [pda] = await deriveAttestationPda({
    credential: toSas(credential),
    schema: toSas(schema),
    nonce: toSas(nonce),
  });
  return fromSas(pda);
}

export async function eventAuthorityAddress(): Promise<Address> {
  return fromSas(await deriveEventAuthorityAddress());
}

export function createCredentialInstruction(input: {
  payer: KeyPairSigner;
  authority: KeyPairSigner;
  credential: Address;
  name: string;
  signers: readonly Address[];
}): Instruction {
  return fromSasInstruction(
    getCreateCredentialInstruction({
      payer: toSasSigner(input.payer),
      authority: toSasSigner(input.authority),
      credential: toSas(input.credential),
      name: input.name,
      signers: input.signers.map(toSas),
    }),
  );
}

export function createSchemaInstruction(input: {
  payer: KeyPairSigner;
  authority: KeyPairSigner;
  credential: Address;
  schema: Address;
  name: string;
  description: string;
  layout: readonly number[];
  fieldNames: readonly string[];
}): Instruction {
  return fromSasInstruction(
    getCreateSchemaInstruction({
      payer: toSasSigner(input.payer),
      authority: toSasSigner(input.authority),
      credential: toSas(input.credential),
      schema: toSas(input.schema),
      name: input.name,
      description: input.description,
      layout: Uint8Array.from(input.layout),
      fieldNames: [...input.fieldNames],
    }),
  );
}

export function createAttestationInstruction(input: {
  payer: KeyPairSigner;
  authority: KeyPairSigner;
  credential: Address;
  schema: Address;
  attestation: Address;
  nonce: Address;
  data: Uint8Array;
  expiry: bigint;
}): Instruction {
  return fromSasInstruction(
    getCreateAttestationInstruction({
      payer: toSasSigner(input.payer),
      authority: toSasSigner(input.authority),
      credential: toSas(input.credential),
      schema: toSas(input.schema),
      attestation: toSas(input.attestation),
      nonce: toSas(input.nonce),
      data: input.data,
      expiry: input.expiry,
    }),
  );
}

/** Closes an attestation; the SAS program returns its rent to the payer (close_attestation.rs). */
export function closeAttestationInstruction(input: {
  payer: KeyPairSigner;
  authority: KeyPairSigner;
  credential: Address;
  attestation: Address;
}): Instruction {
  return fromSasInstruction(
    getCloseAttestationInstruction({
      payer: toSasSigner(input.payer),
      authority: toSasSigner(input.authority),
      credential: toSas(input.credential),
      attestation: toSas(input.attestation),
    }),
  );
}

export type CredentialAccount = {
  authority: Address;
  name: string;
  authorizedSigners: Address[];
};

export type SchemaAccount = {
  credential: Address;
  name: string;
  description: string;
  layout: number[];
  fieldNames: string[];
  isPaused: boolean;
  version: number;
  /** The decoded account in sas-lib form, for attestation data (de)serialization. */
  sas: SasSchema;
};

export type AttestationAccount = {
  nonce: Address;
  credential: Address;
  schema: Address;
  data: Uint8Array;
  signer: Address;
  expiry: bigint;
  tokenAccount: Address;
};

const utf8 = new TextDecoder("utf-8", { fatal: true });

function expectDiscriminator(bytes: Uint8Array, expected: number, kind: string): void {
  if (bytes[0] !== expected) {
    throw new Error(`not a SAS ${kind} account (discriminator ${bytes[0]}, expected ${expected})`);
  }
}

/** Schema field names are stored as consecutive u32 little endian length prefixed UTF-8 strings. */
export function splitFieldNames(bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const names: string[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) throw new Error("truncated schema field names");
    const length = view.getUint32(offset, true);
    offset += 4;
    if (offset + length > bytes.length) throw new Error("truncated schema field names");
    names.push(utf8.decode(bytes.subarray(offset, offset + length)));
    offset += length;
  }
  return names;
}

export function decodeCredentialAccount(bytes: Uint8Array): CredentialAccount {
  expectDiscriminator(bytes, SAS_ACCOUNT_DISCRIMINATOR.credential, "credential");
  const credential = getCredentialDecoder().decode(bytes);
  return {
    authority: fromSas(credential.authority),
    name: utf8.decode(Uint8Array.from(credential.name)),
    authorizedSigners: credential.authorizedSigners.map(fromSas),
  };
}

export function decodeSchemaAccount(bytes: Uint8Array): SchemaAccount {
  expectDiscriminator(bytes, SAS_ACCOUNT_DISCRIMINATOR.schema, "schema");
  const schema = getSchemaDecoder().decode(bytes);
  return {
    credential: fromSas(schema.credential),
    name: utf8.decode(Uint8Array.from(schema.name)),
    description: utf8.decode(Uint8Array.from(schema.description)),
    layout: [...schema.layout],
    fieldNames: splitFieldNames(Uint8Array.from(schema.fieldNames)),
    isPaused: schema.isPaused,
    version: schema.version,
    sas: schema,
  };
}

export function decodeAttestationAccount(bytes: Uint8Array): AttestationAccount {
  expectDiscriminator(bytes, SAS_ACCOUNT_DISCRIMINATOR.attestation, "attestation");
  const attestation = getAttestationDecoder().decode(bytes);
  return {
    nonce: fromSas(attestation.nonce),
    credential: fromSas(attestation.credential),
    schema: fromSas(attestation.schema),
    data: Uint8Array.from(attestation.data),
    signer: fromSas(attestation.signer),
    expiry: attestation.expiry,
    tokenAccount: fromSas(attestation.tokenAccount),
  };
}

export function encodeAttestationData(
  schema: SchemaAccount,
  data: Record<string, unknown>,
): Uint8Array {
  return serializeAttestationData(schema.sas, data);
}

export function decodeAttestationData(
  schema: SchemaAccount,
  data: Uint8Array,
): Record<string, unknown> {
  return deserializeAttestationData<Record<string, unknown>>(schema.sas, data);
}
