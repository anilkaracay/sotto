// @sotto/sdk/proofs (step 2.7): the counterparty hash of X-32 is SHA-256 of the 16 byte salt and the
// UTF-8 label; the verify instruction's data is laid out as the program reads it (one byte, the
// threshold, the nonce, the expiry, the hash); a record nonce has bump 255; the context accounts come
// out of verification instructions of both shapes; and the ProofVerified event reads back from the
// log line the program writes (programs/sotto_proofs/tests/verify.rs checks the same line onchain).
import { createHash } from "node:crypto";
import { AccountRole, address, getAddressEncoder, type Address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  contextAccounts,
  counterpartyHash,
  findProofRecordPda,
  getVerifyBalanceThresholdInstructionDataEncoder,
  proofVerifiedEvent,
  randomBytes16,
  recordNonce,
  sottoProofsErrorCode,
  SOTTO_PROOFS_ERROR__CIPHERTEXT_MISMATCH,
  SOTTO_PROOFS_PROGRAM_ADDRESS,
} from "../src/proofs/index.ts";

const ZK = address("ZkE1Gama1Proof11111111111111111111111111111");
const TOKEN = address("5xhtiW4M8bbModvzx4ckUvVpFRZmz7bm8q1HHLdh88ja");
const [EQUALITY, RANGE, RECORD_ACCOUNT, OWNER] = [
  address("9sQLe9fXtAHezouWVAbunqm4td9Rsg6sEfYjeheJLgHz"),
  address("3jQWYMoKNXGmYZESFLYYWd8u64yywAwGXBsP3G4bzj2s"),
  address("DJUpp4wFg8py5u7LuJWXH38d8QGgrGNfFtqon4xuLmsB"),
  address("7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L"),
];

describe("sotto_proofs client", () => {
  it("hashes the counterparty as SHA-256 of the salt then the UTF-8 label (X-32)", async () => {
    const salt = Uint8Array.from({ length: 16 }, (_, index) => index);
    const expected = createHash("sha256")
      .update(salt)
      .update(Buffer.from("Harbor Bank Ş", "utf8"))
      .digest();
    expect(Buffer.from(await counterpartyHash(salt, "Harbor Bank Ş"))).toEqual(expected);
    await expect(counterpartyHash(new Uint8Array(15), "x")).rejects.toThrow("16 bytes");
    expect(randomBytes16()).toHaveLength(16);
  });

  it("lays out the verify instruction data as the program reads it", () => {
    const nonce = Uint8Array.from({ length: 16 }, (_, index) => 100 + index);
    const hash = new Uint8Array(32).fill(7);
    const data = getVerifyBalanceThresholdInstructionDataEncoder().encode({
      threshold: 7_000_000n,
      nonce,
      expiry: -2n,
      counterpartyHash: hash,
    });
    const expected = new Uint8Array(65);
    const view = new DataView(expected.buffer);
    expected[0] = 2;
    view.setBigUint64(1, 7_000_000n, true);
    expected.set(nonce, 9);
    view.setBigInt64(25, -2n, true);
    expected.set(hash, 33);
    expect(new Uint8Array(data)).toEqual(expected);
  });

  it("picks record nonces whose address has bump 255", async () => {
    for (let run = 0; run < 8; run++) {
      const nonce = await recordNonce(TOKEN, SOTTO_PROOFS_PROGRAM_ADDRESS);
      const [, bump] = await findProofRecordPda({ tokenAccount: TOKEN, nonce });
      expect(bump).toBe(255);
    }
  });

  it("finds the context accounts of inline and account backed verifications", () => {
    const inline = {
      programAddress: ZK,
      accounts: [
        { address: EQUALITY, role: AccountRole.WRITABLE },
        { address: OWNER, role: AccountRole.READONLY },
      ],
      data: new Uint8Array([3, ...new Uint8Array(224)]),
    };
    // A range proof staged in a record account: the proof account, then the context.
    const fromAccount = {
      programAddress: ZK,
      accounts: [
        { address: RECORD_ACCOUNT, role: AccountRole.READONLY },
        { address: RANGE, role: AccountRole.WRITABLE },
        { address: OWNER, role: AccountRole.READONLY },
      ],
      data: new Uint8Array([6, 0, 0, 0, 0]),
    };
    const unrelated = { programAddress: TOKEN, accounts: [], data: new Uint8Array([3]) };
    expect(contextAccounts([unrelated, inline, fromAccount])).toEqual({
      equalityContext: EQUALITY,
      rangeContext: RANGE,
    });
    expect(() => contextAccounts([inline])).toThrow("an equality and a range proof");
  });

  it("reads the ProofVerified event from the program's log line", () => {
    const encoder = getAddressEncoder();
    const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
    const le = (value: bigint, signed = false) => {
      const bytes = new Uint8Array(8);
      if (signed) new DataView(bytes.buffer).setBigInt64(0, value, true);
      else new DataView(bytes.buffer).setBigUint64(0, value, true);
      return bytes;
    };
    const key = (value: Address) => new Uint8Array(encoder.encode(value));
    const line = `Program data: ${[
      new TextEncoder().encode("ProofVerified"),
      key(RECORD_ACCOUNT),
      key(TOKEN),
      key(OWNER),
      le(7_000_000n),
      le(505_620_617n),
      le(1_790_000_000n, true),
    ]
      .map(b64)
      .join(" ")}`;
    expect(proofVerifiedEvent(["Program log: other", line])).toEqual({
      record: RECORD_ACCOUNT,
      tokenAccount: TOKEN,
      owner: OWNER,
      threshold: 7_000_000n,
      slot: 505_620_617n,
      expiry: 1_790_000_000n,
    });
    expect(proofVerifiedEvent(["Program data: AAAA"])).toBeNull();
  });
  it("reads the program's error code from a failed simulation or transaction", () => {
    const program = SOTTO_PROOFS_PROGRAM_ADDRESS;
    const simulated = {
      err: { InstructionError: [0n, { Custom: 12n }] },
      decoded: { programAddress: program },
    };
    expect(sottoProofsErrorCode(simulated, program)).toBe(SOTTO_PROOFS_ERROR__CIPHERTEXT_MISMATCH);
    // Another program's error 12 is not the program's.
    expect(
      sottoProofsErrorCode({ ...simulated, decoded: { programAddress: TOKEN } }, program),
    ).toBeNull();
    // A landed transaction's error names no program: the first instruction is the program's.
    expect(sottoProofsErrorCode({ err: { InstructionError: [0, { Custom: 2 }] } }, program)).toBe(
      2,
    );
    expect(
      sottoProofsErrorCode({ err: { InstructionError: [1, { Custom: 2 }] } }, program),
    ).toBeNull();
    expect(sottoProofsErrorCode(new Error("refused"), program)).toBeNull();
  });
});
