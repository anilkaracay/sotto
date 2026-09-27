// The fixed keypair wallet of the keys spec: the keypair of the step 1.5 spl-token CLI check
// (VERIFICATION-LOG), derived from a public seed, so its keys are test data and it never holds funds.
// The CLI configured the ElGamal key below for it; the browser must derive the same key.
import { createHash, createPrivateKey, createPublicKey } from "node:crypto";
import { getAddressDecoder } from "@solana/kit";

export const E2E_KEYPAIR_SEED = createHash("sha256").update("sotto-cli-key-check/v1").digest();
export const E2E_ADMIN_WALLET = "EQMW3o1DVsB72Ej1RRRmHLW1XaEpbjLKrMHUbS8cRLZC";
export const E2E_CLI_ELGAMAL_KEY = "BxMVLbjVntF9DJtDjfpQLrgw4hopedMgNkZZKGcVkZp6";

/** The 64 byte Solana keypair (seed, then public key) for the test wallet. */
export function e2eKeypair(): number[] {
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), E2E_KEYPAIR_SEED]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .subarray(-32);
  return [...E2E_KEYPAIR_SEED, ...publicKey];
}

/** Another fixed test wallet from a seed text (localnet specs): its 64 byte keypair and address. */
export function seededKeypair(seedText: string): { keypair: number[]; address: string } {
  const seed = createHash("sha256").update(seedText).digest();
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .subarray(-32);
  return {
    keypair: [...seed, ...publicKey],
    address: getAddressDecoder().decode(new Uint8Array(publicKey)),
  };
}
