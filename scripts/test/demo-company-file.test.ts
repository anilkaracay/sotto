// The demo company's file (step 4.6, D-32): it holds derived viewing keys and nothing that signs.
import { openJson, sealJson } from "@sotto/sdk/disclosure/seal";
import { deriveViewingKey, viewingKeyFromSecret, viewKeyMessage } from "@sotto/sdk/keys";
import {
  createKeyPairFromBytes,
  createKeyPairFromPrivateKeyBytes,
  getAddressFromPublicKey,
  getBase58Decoder,
  signBytes,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import { demoCompanyFile } from "../demo-company-file.ts";

const ORG = "0b8f3c3e-5d53-4d4e-9d7f-0f3f2d1c0a11";
const PAYMENT = "8d0a4c56-1f0e-4a3b-9c2d-5e6f7a8b9c0d";

/** A 64 byte keypair as a Solana keypair file holds it: the seed, then the public key. */
async function keypair(fill: number): Promise<Uint8Array> {
  const seed = new Uint8Array(32).fill(fill);
  const keys = await createKeyPairFromPrivateKeyBytes(seed, true);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  return new Uint8Array([...seed, ...publicKey]);
}

describe("the demo company's file", () => {
  it("holds each role's wallet and the viewing key that wallet derives, and nothing that signs", async () => {
    const keypairs = {
      owner: await keypair(1),
      accountant: await keypair(2),
      employee: await keypair(3),
    };
    const file = await demoCompanyFile({ orgId: ORG, comparePaymentId: PAYMENT, keypairs });
    expect(file).toMatchObject({ v: 1, cluster: "devnet", orgId: ORG, comparePaymentId: PAYMENT });
    const text = JSON.stringify(file);
    for (const role of ["owner", "accountant", "employee"] as const) {
      const keys = await createKeyPairFromBytes(keypairs[role]);
      const wallet = await getAddressFromPublicKey(keys.publicKey);
      const signature = new Uint8Array(await signBytes(keys.privateKey, viewKeyMessage(wallet)));
      const derived = await deriveViewingKey(wallet, new Uint8Array(signature));
      expect(file.roles[role]).toEqual({
        wallet,
        viewingKey: Buffer.from(derived.secretKey).toString("base64"),
      });
      // The key in the file opens what is sealed to the wallet's registered viewing key.
      const published = await viewingKeyFromSecret(
        new Uint8Array(Buffer.from(file.roles[role].viewingKey, "base64")),
      );
      expect(await openJson(await sealJson({ v: 1 }, derived.publicKey), published)).toEqual({
        v: 1,
      });
      // Neither the wallet's secret key nor its signature is in the file, in any encoding.
      for (const secret of [keypairs[role].slice(0, 32), keypairs[role], signature]) {
        expect(text).not.toContain(Buffer.from(secret).toString("base64"));
        expect(text).not.toContain(Buffer.from(secret).toString("hex"));
        expect(text).not.toContain(getBase58Decoder().decode(secret));
      }
    }
  });

  it("refuses ids that are not ids and one wallet in two roles", async () => {
    const keypairs = {
      owner: await keypair(1),
      accountant: await keypair(2),
      employee: await keypair(3),
    };
    await expect(
      demoCompanyFile({ orgId: "northwind", comparePaymentId: PAYMENT, keypairs }),
    ).rejects.toThrow("--org is not an organization ID");
    await expect(
      demoCompanyFile({ orgId: ORG, comparePaymentId: "atlas", keypairs }),
    ).rejects.toThrow("--payment is not a payment ID");
    await expect(
      demoCompanyFile({
        orgId: ORG,
        comparePaymentId: PAYMENT,
        keypairs: { ...keypairs, employee: keypairs.owner },
      }),
    ).rejects.toThrow("three different wallets");
  });
});
