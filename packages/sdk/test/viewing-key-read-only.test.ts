// A published viewing key reads and does nothing else (step 4.6, D-32; founder, 2026-10-09): the demo
// company publishes the derived viewing secret keys of its roles. Such a key opens what was sealed to
// it. It is an X25519 key, not the wallet's Ed25519 key: used as a signing key it makes another
// address, so it produces no manifest signature the owner's wallet would have made and it cannot sign
// a transaction of the wallet.
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairFromPrivateKeyBytes,
  createTransactionMessage,
  getAddressFromPublicKey,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signBytes,
  signTransaction,
  verifySignature,
  type Blockhash,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import { createNoopSigner } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { buildManifest, manifestMessage, verifyManifest } from "../src/disclosure/index.ts";
import { openJson, sealJson } from "../src/disclosure/seal.ts";
import { deriveViewingKey, viewingKeyFromSecret, viewKeyMessage } from "../src/keys/index.ts";

const ORG = "0b8f3c3e-5d53-4d4e-9d7f-0f3f2d1c0a11";
const VIEWER = "3f1d2c4b-5a69-4786-9a0b-1c2d3e4f5a6b";

async function keypair(seed: Uint8Array) {
  const keys = await createKeyPairFromPrivateKeyBytes(seed);
  return {
    keys,
    address: await getAddressFromPublicKey(keys.publicKey),
    sign: async (message: Uint8Array) => new Uint8Array(await signBytes(keys.privateKey, message)),
  };
}

describe("a published viewing key (step 4.6, D-32)", () => {
  it("is the keypair the wallet registered, from the secret key alone, and opens what was sealed to it", async () => {
    const owner = await keypair(crypto.getRandomValues(new Uint8Array(32)));
    const derived = await deriveViewingKey(
      owner.address,
      await owner.sign(viewKeyMessage(owner.address)),
    );
    const published = await viewingKeyFromSecret(derived.secretKey);
    expect(published.publicKey).toEqual(derived.publicKey);
    const value = { v: 1, amount: "48200000000" };
    expect(await openJson(await sealJson(value, derived.publicKey), published)).toEqual(value);
    await expect(viewingKeyFromSecret(new Uint8Array(31))).rejects.toThrow(/32 bytes/);
  });

  it("cannot produce a valid manifest signature", async () => {
    const owner = await keypair(crypto.getRandomValues(new Uint8Array(32)));
    const viewing = await deriveViewingKey(
      owner.address,
      await owner.sign(viewKeyMessage(owner.address)),
    );
    // The most a holder can do with the 32 bytes: use them as a signing key of their own.
    const impostor = await keypair(new Uint8Array(viewing.secretKey));
    expect(impostor.address).not.toBe(owner.address);

    const ciphertext = await sealJson({ v: 1, amount: "1" }, viewing.publicKey);
    const manifest = await buildManifest({
      org: ORG,
      createdAt: "2026-10-09T12:00:00.000Z",
      items: [{ id: "8d0a4c56-1f0e-4a3b-9c2d-5e6f7a8b9c0d", viewer: VIEWER, ciphertext }],
    });
    const message = await manifestMessage(manifest);
    expect(
      await verifyManifest({
        manifest,
        signature: await impostor.sign(message),
        ownerWallet: owner.address,
        org: ORG,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
    // Nor do the key's bytes themselves pass as a signature, alone or doubled to 64 bytes.
    for (const forged of [
      viewing.secretKey,
      new Uint8Array([...viewing.secretKey, ...viewing.publicKey]),
    ]) {
      expect(
        await verifyManifest({ manifest, signature: forged, ownerWallet: owner.address, org: ORG }),
      ).toEqual({ ok: false, reason: "bad_signature" });
    }
    // The owner's wallet still can.
    expect(
      await verifyManifest({
        manifest,
        signature: await owner.sign(message),
        ownerWallet: owner.address,
        org: ORG,
      }),
    ).toEqual({ ok: true });
  });

  it("cannot sign any transaction of the wallet", async () => {
    const owner = await keypair(crypto.getRandomValues(new Uint8Array(32)));
    const viewing = await deriveViewingKey(
      owner.address,
      await owner.sign(viewKeyMessage(owner.address)),
    );
    const impostor = await keypair(new Uint8Array(viewing.secretKey));
    const transaction = compileTransaction(
      pipe(
        createTransactionMessage({ version: 0 }),
        (message) => setTransactionMessageFeePayer(owner.address, message),
        (message) =>
          setTransactionMessageLifetimeUsingBlockhash(
            {
              blockhash: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY" as Blockhash,
              lastValidBlockHeight: 1n,
            },
            message,
          ),
        (message) =>
          appendTransactionMessageInstructions(
            [
              getTransferSolInstruction({
                source: createNoopSigner(owner.address),
                destination: impostor.address,
                amount: 1n,
              }),
            ],
            message,
          ),
      ),
    );
    // The wallet is the transaction's only signer, and the key is not the wallet's.
    expect(Object.keys(transaction.signatures)).toEqual([owner.address]);
    await expect(signTransaction([impostor.keys], transaction)).rejects.toThrow();
    // A signature made with it over the message does not verify for the wallet.
    const forged = await signBytes(impostor.keys.privateKey, transaction.messageBytes);
    expect(await verifySignature(owner.keys.publicKey, forged, transaction.messageBytes)).toBe(
      false,
    );
    expect(await verifySignature(impostor.keys.publicKey, forged, transaction.messageBytes)).toBe(
      true,
    );
  });
});
