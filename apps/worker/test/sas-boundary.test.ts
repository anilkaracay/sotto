// D-24: G5 tests the conversion between sas-lib (built on @solana/kit 5) and the worker (@solana/kit
// 8). These tests check at runtime what the boundary's type casts assume.
import { createRequire } from "node:module";
import {
  AccountRole,
  appendTransactionMessageInstructions,
  blockhash,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  getCompiledTransactionMessageDecoder,
  getProgramDerivedAddress,
  getPublicKeyFromAddress,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  verifySignature,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import {
  getAttestationEncoder,
  getCredentialEncoder,
  getSchemaEncoder,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
} from "sas-lib";
import { beforeAll, describe, expect, it } from "vitest";
import {
  BUSINESS_SCHEMA_DESCRIPTION,
  BUSINESS_SCHEMA_FIELD_NAMES,
  BUSINESS_SCHEMA_LAYOUT,
  BUSINESS_SCHEMA_NAME,
  SOTTO_CREDENTIAL_NAME,
} from "../src/sas/business-schema.ts";
import {
  assertBusinessSchema,
  customErrorCode,
  SAS_ERROR_NAMES,
  SAS_INVALID_ATTESTATION,
} from "../src/sas/client.ts";
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
  eventAuthorityAddress,
  SAS_PROGRAM_ADDRESS,
  splitFieldNames,
} from "../src/sas/sas-lib-boundary.ts";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const utf8 = (text: string) => new TextEncoder().encode(text);
const encoder = getAddressEncoder();

/** The program stores field names as consecutive u32 little endian length prefixed strings. */
function joinFieldNames(names: readonly string[]): Uint8Array {
  const parts = names.map((name) => {
    const bytes = utf8(name);
    const out = new Uint8Array(4 + bytes.length);
    new DataView(out.buffer).setUint32(0, bytes.length, true);
    out.set(bytes, 4);
    return out;
  });
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

function businessSchemaBytes(credential: Address): Uint8Array {
  return new Uint8Array(
    getSchemaEncoder().encode({
      discriminator: 1,
      credential: credential as never,
      name: utf8(BUSINESS_SCHEMA_NAME),
      description: utf8(BUSINESS_SCHEMA_DESCRIPTION),
      layout: Uint8Array.from(BUSINESS_SCHEMA_LAYOUT),
      fieldNames: joinFieldNames(BUSINESS_SCHEMA_FIELD_NAMES),
      isPaused: false,
      version: 1,
    }),
  );
}

let signer: KeyPairSigner;
let credential: Address;
let schema: Address;
let owner: Address;

beforeAll(async () => {
  signer = await generateKeyPairSigner();
  owner = (await generateKeyPairSigner()).address;
  credential = await deriveCredentialAddress(signer.address, SOTTO_CREDENTIAL_NAME);
  schema = await deriveSchemaAddress(credential, BUSINESS_SCHEMA_NAME, 1);
});

describe("kit 5 (inside sas-lib) and kit 8 (worker)", () => {
  it("resolve to different kit versions with the same AccountRole numbers", async () => {
    const requireFromSasLib = createRequire(createRequire(import.meta.url).resolve("sas-lib"));
    const kitPath = requireFromSasLib.resolve("@solana/kit");
    expect(kitPath).toContain("@solana+kit@5.");
    const kit5 = requireFromSasLib("@solana/kit") as { AccountRole: Record<string, number> };
    expect(kit5.AccountRole.READONLY).toBe(AccountRole.READONLY);
    expect(kit5.AccountRole.WRITABLE).toBe(AccountRole.WRITABLE);
    expect(kit5.AccountRole.READONLY_SIGNER).toBe(AccountRole.READONLY_SIGNER);
    expect(kit5.AccountRole.WRITABLE_SIGNER).toBe(AccountRole.WRITABLE_SIGNER);
  });

  it("agree on the SAS program address (facts E3)", () => {
    expect(SAS_PROGRAM_ADDRESS).toBe("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");
    expect(SAS_PROGRAM_ADDRESS).toBe(String(SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS));
  });
});

describe("PDAs (08 section 5)", () => {
  it("match the program seeds derived independently with kit 8", async () => {
    const pda = async (seeds: (string | Uint8Array)[]) =>
      (await getProgramDerivedAddress({ programAddress: SAS_PROGRAM_ADDRESS, seeds }))[0];
    expect(credential).toBe(
      await pda([
        "credential",
        new Uint8Array(encoder.encode(signer.address)),
        SOTTO_CREDENTIAL_NAME,
      ]),
    );
    expect(schema).toBe(
      await pda([
        "schema",
        new Uint8Array(encoder.encode(credential)),
        BUSINESS_SCHEMA_NAME,
        Uint8Array.from([1]),
      ]),
    );
    expect(await deriveAttestationAddress(credential, schema, owner)).toBe(
      await pda([
        "attestation",
        new Uint8Array(encoder.encode(credential)),
        new Uint8Array(encoder.encode(schema)),
        new Uint8Array(encoder.encode(owner)),
      ]),
    );
    expect(await eventAuthorityAddress()).toBe(await pda(["__event_authority"]));
  });

  it("give each owner its own attestation address", async () => {
    const other = (await generateKeyPairSigner()).address;
    expect(await deriveAttestationAddress(credential, schema, owner)).not.toBe(
      await deriveAttestationAddress(credential, schema, other),
    );
  });
});

describe("sas-lib instructions in kit 8 transactions", () => {
  it("keep the account order and roles of the program", async () => {
    const create = createCredentialInstruction({
      payer: signer,
      authority: signer,
      credential,
      name: SOTTO_CREDENTIAL_NAME,
      signers: [signer.address],
    });
    expect(create.programAddress).toBe(SAS_PROGRAM_ADDRESS);
    expect(create.accounts?.map((a) => [a.address, a.role])).toEqual([
      [signer.address, AccountRole.WRITABLE_SIGNER],
      [credential, AccountRole.WRITABLE],
      [signer.address, AccountRole.READONLY_SIGNER],
      [SYSTEM_PROGRAM, AccountRole.READONLY],
    ]);
    const close = closeAttestationInstruction({
      payer: signer,
      authority: signer,
      credential,
      attestation: owner,
    });
    expect(close.accounts?.map((a) => a.address)).toEqual([
      signer.address,
      signer.address,
      credential,
      owner,
      await eventAuthorityAddress(),
      SYSTEM_PROGRAM,
      SAS_PROGRAM_ADDRESS,
    ]);
  });

  it("are signed by the kit 8 signer they carry, once, with a valid signature", async () => {
    const instructions = [
      createCredentialInstruction({
        payer: signer,
        authority: signer,
        credential,
        name: SOTTO_CREDENTIAL_NAME,
        signers: [signer.address],
      }),
      createSchemaInstruction({
        payer: signer,
        authority: signer,
        credential,
        schema,
        name: BUSINESS_SCHEMA_NAME,
        description: BUSINESS_SCHEMA_DESCRIPTION,
        layout: BUSINESS_SCHEMA_LAYOUT,
        fieldNames: BUSINESS_SCHEMA_FIELD_NAMES,
      }),
    ];
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayerSigner(signer, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          { blockhash: blockhash(SYSTEM_PROGRAM), lastValidBlockHeight: 0n },
          m,
        ),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    const signed = await signTransactionMessageWithSigners(message);
    expect(Object.keys(signed.signatures)).toEqual([signer.address]);
    const signature = signed.signatures[signer.address];
    if (!signature) throw new Error("missing signature");
    const key = await getPublicKeyFromAddress(signer.address);
    expect(await verifySignature(key, signature, signed.messageBytes)).toBe(true);
    const compiled = getCompiledTransactionMessageDecoder().decode(signed.messageBytes);
    expect(compiled.header.numSignerAccounts).toBe(1);
    expect(compiled.header.numReadonlySignerAccounts).toBe(0);
    expect(compiled.staticAccounts[0]).toBe(signer.address);
  });
});

describe("account decoders and attestation data", () => {
  it("decode a credential and check its discriminator", () => {
    const bytes = new Uint8Array(
      getCredentialEncoder().encode({
        discriminator: 0,
        authority: signer.address as never,
        name: utf8(SOTTO_CREDENTIAL_NAME),
        authorizedSigners: [signer.address as never],
      }),
    );
    expect(decodeCredentialAccount(bytes)).toEqual({
      authority: signer.address,
      name: SOTTO_CREDENTIAL_NAME,
      authorizedSigners: [signer.address],
    });
    expect(() => decodeCredentialAccount(businessSchemaBytes(credential))).toThrow(
      "not a SAS credential account (discriminator 1, expected 0)",
    );
  });

  it("decode the business schema, split its field names and accept it", () => {
    const decoded = decodeSchemaAccount(businessSchemaBytes(credential));
    expect(decoded).toMatchObject({
      credential,
      name: BUSINESS_SCHEMA_NAME,
      description: BUSINESS_SCHEMA_DESCRIPTION,
      layout: [12, 12, 12, 8, 0],
      fieldNames: ["org_id", "legal_name", "country", "verified_at", "level"],
      isPaused: false,
      version: 1,
    });
    expect(() => assertBusinessSchema(decoded, credential)).not.toThrow();
    expect(() =>
      assertBusinessSchema({ ...decoded, layout: [12, 12, 12, 3, 0] }, credential),
    ).toThrow("schema does not match sotto.business.v1: layout");
    expect(() => assertBusinessSchema(decoded, owner)).toThrow("credential");
    expect(() => splitFieldNames(Uint8Array.from([5, 0, 0, 0, 97]))).toThrow("truncated");
  });

  it("serialize business data as Borsh: u32 length prefixed strings, i64 and u8 little endian", () => {
    const decoded = decodeSchemaAccount(businessSchemaBytes(credential));
    const data = { org_id: "o", legal_name: "L", country: "ZZ", verified_at: 1n, level: 1 };
    const bytes = encodeAttestationData(decoded, data);
    expect([...bytes]).toEqual([
      1, 0, 0, 0, 111, 1, 0, 0, 0, 76, 2, 0, 0, 0, 90, 90, 1, 0, 0, 0, 0, 0, 0, 0, 1,
    ]);
    const big = { ...data, org_id: "8c1d9a52-0000-4000-8000-000000000000", verified_at: 2n ** 62n };
    const roundTrip = decodeAttestationData(decoded, encodeAttestationData(decoded, big));
    expect(BigInt(roundTrip.verified_at as bigint | number)).toBe(2n ** 62n);
    expect({ ...roundTrip, verified_at: big.verified_at }).toEqual(big);
  });

  it("decode an attestation", async () => {
    const data = Uint8Array.from([1, 2, 3]);
    const bytes = new Uint8Array(
      getAttestationEncoder().encode({
        discriminator: 2,
        nonce: owner as never,
        credential: credential as never,
        schema: schema as never,
        data,
        signer: signer.address as never,
        expiry: 1_790_000_000n,
        tokenAccount: SYSTEM_PROGRAM as never,
      }),
    );
    expect(decodeAttestationAccount(bytes)).toEqual({
      nonce: owner,
      credential,
      schema,
      data,
      signer: signer.address,
      expiry: 1_790_000_000n,
      tokenAccount: SYSTEM_PROGRAM,
    });
    const attestation = await deriveAttestationAddress(credential, schema, owner);
    const create = createAttestationInstruction({
      payer: signer,
      authority: signer,
      credential,
      schema,
      attestation,
      nonce: owner,
      data,
      expiry: 1_790_000_000n,
    });
    expect(create.accounts?.map((a) => [a.address, a.role])).toEqual([
      [signer.address, AccountRole.WRITABLE_SIGNER],
      [signer.address, AccountRole.READONLY_SIGNER],
      [credential, AccountRole.READONLY],
      [schema, AccountRole.READONLY],
      [attestation, AccountRole.WRITABLE],
      [SYSTEM_PROGRAM, AccountRole.READONLY],
    ]);
  });
});

describe("SAS errors", () => {
  it("read the custom code of a failed instruction", () => {
    expect(customErrorCode({ InstructionError: [0n, { Custom: 2n }] })).toBe(2);
    expect(customErrorCode({ InstructionError: [1, { Custom: 5 }] })).toBe(5);
    expect(customErrorCode({ InstructionError: [0, "InvalidAccountData"] })).toBeNull();
    expect(customErrorCode("AccountNotFound")).toBeNull();
    expect(customErrorCode(null)).toBeNull();
    expect(SAS_ERROR_NAMES[SAS_INVALID_ATTESTATION]).toBe("InvalidAttestation");
  });
});
