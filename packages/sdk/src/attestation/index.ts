// `@sotto/sdk/attestation` (step 2.8): reads a Sotto business attestation from its account bytes,
// without sas-lib (D-24 keeps sas-lib in apps/worker). The public proof page finds an organization's
// attestation from a proof record's owner alone (nonce = the owner's wallet), at the PDA of
// `["attestation", credential, schema, nonce]` under the SAS program (facts E4), which only an
// authorized signer of the Sotto credential can create. Layouts: the attestation account (SAS
// `state/attestation.rs`: discriminator 2, nonce, credential, schema, data with a u32 length, signer,
// expiry i64, token account) and the `sotto.business.v1` data in Borsh (facts E5: org_id, legal_name,
// country as strings with a u32 length, verified_at i64, level u8). `apps/worker/test/sas-boundary.test.ts`
// checks both against sas-lib.
import {
  getAddressDecoder,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
} from "@solana/kit";

export const ATTESTATION_DISCRIMINATOR = 2;

export type BusinessAttestationAccount = {
  nonce: Address;
  credential: Address;
  schema: Address;
  signer: Address;
  /** Unix seconds; 0 means it never expires. */
  expiry: bigint;
  tokenAccount: Address;
  data: {
    orgId: string;
    legalName: string;
    country: string;
    /** Unix seconds. */
    verifiedAt: bigint;
    level: number;
  };
};

/** The attestation of `nonce` under a credential and schema (facts E4). */
export async function attestationAddress(input: {
  sasProgram: Address;
  credential: Address;
  schema: Address;
  nonce: Address;
}): Promise<Address> {
  const encoder = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: input.sasProgram,
    seeds: [
      "attestation",
      encoder.encode(input.credential),
      encoder.encode(input.schema),
      encoder.encode(input.nonce),
    ],
  });
  return pda;
}

export class AttestationFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttestationFormatError";
  }
}

/** A cursor over account bytes that refuses to read past the end. */
function reader(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const addresses = getAddressDecoder();
  let offset = 0;
  const take = (length: number) => {
    if (length < 0 || offset + length > bytes.length) {
      throw new AttestationFormatError("the attestation ends early");
    }
    const part = bytes.subarray(offset, offset + length);
    offset += length;
    return part;
  };
  return {
    u8: () => take(1)[0] as number,
    u32: () => {
      const value = view.getUint32(offset, true);
      take(4);
      return value;
    },
    i64: () => {
      take(8);
      return view.getBigInt64(offset - 8, true);
    },
    address: () => addresses.decode(take(32)),
    bytes: take,
    done: () => offset === bytes.length,
  };
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

/** Decodes a `sotto.business.v1` attestation account; throws on any other shape. */
export function decodeBusinessAttestation(bytes: Uint8Array): BusinessAttestationAccount {
  const account = reader(bytes);
  if (account.u8() !== ATTESTATION_DISCRIMINATOR) {
    throw new AttestationFormatError("not an attestation account");
  }
  const nonce = account.address();
  const credential = account.address();
  const schema = account.address();
  const data = account.bytes(account.u32());
  const signer = account.address();
  const expiry = account.i64();
  const tokenAccount = account.address();
  if (!account.done()) throw new AttestationFormatError("the attestation has trailing bytes");

  const fields = reader(data);
  const text = () => utf8.decode(fields.bytes(fields.u32()));
  const orgId = text();
  const legalName = text();
  const country = text();
  const verifiedAt = fields.i64();
  const level = fields.u8();
  if (!fields.done()) throw new AttestationFormatError("the data is not sotto.business.v1");
  return {
    nonce,
    credential,
    schema,
    signer,
    expiry,
    tokenAccount,
    data: { orgId, legalName, country, verifiedAt, level },
  };
}
