// Keys (06 sections 1 and 2, 07 section 5): the standard_v1 derivation against the spl-token CLI,
// the signed message checks, the ElGamal key match (I-5), the viewing key and its registration (I-8).
import { createHash, createPrivateKey, createPublicKey, hkdfSync } from "node:crypto";
import {
  address,
  createKeyPairFromPrivateKeyBytes,
  getAddressFromPublicKey,
  signBytes,
  type Address,
} from "@solana/kit";
import { ConfidentialKeys } from "@solana/zk-sdk/bundler";
import { describe, expect, it } from "vitest";
import {
  assertElGamalKeyMatches,
  checkSignedMessage,
  confidentialKeysMessage,
  deriveStandardKeys,
  deriveViewingKey,
  elgamalKeyMatches,
  KeyDerivationError,
  KeyMismatchError,
  verifyViewKeyRegistration,
  viewKeyMessage,
  viewKeyRegistrationMessage,
  zeroConfidentialKeys,
} from "../src/keys/index.ts";

// The step 1.5 CLI check: spl-token-cli 5.6.1 configured a confidential account on
// localnet for the keypair with this seed and stored this ElGamal key.
const CLI_SEED = createHash("sha256").update("sotto-cli-key-check/v1").digest();
const CLI_WALLET = "EQMW3o1DVsB72Ej1RRRmHLW1XaEpbjLKrMHUbS8cRLZC";
const CLI_ELGAMAL_KEY = "BxMVLbjVntF9DJtDjfpQLrgw4hopedMgNkZZKGcVkZp6";

async function wallet(seed: Uint8Array) {
  const keys = await createKeyPairFromPrivateKeyBytes(new Uint8Array(seed));
  const walletAddress = await getAddressFromPublicKey(keys.publicKey);
  return {
    address: walletAddress,
    sign: async (message: Uint8Array) => new Uint8Array(await signBytes(keys.privateKey, message)),
  };
}

describe("confidential keys, standard_v1", () => {
  it("signs the constant message of the standard derivation", () => {
    const message = confidentialKeysMessage();
    expect(new TextDecoder().decode(message)).toBe("solana-conf-bal/v1");
    expect(message).toEqual(new Uint8Array(ConfidentialKeys.signerMessage()));
  });

  it("AC-03.2 derives the ElGamal key the spl-token CLI configured for the same keypair", async () => {
    const cli = await wallet(CLI_SEED);
    expect(cli.address).toBe(CLI_WALLET);
    const keys = await deriveStandardKeys(cli.address, await cli.sign(confidentialKeysMessage()));
    expect(keys.elgamalPubkey).toBe(CLI_ELGAMAL_KEY);
    expect(keys.elgamalSecretKey).toHaveLength(32);
    expect(keys.aeKey).toHaveLength(16);
    // Ed25519 signatures are deterministic: the same wallet derives the same keys again.
    const again = await deriveStandardKeys(cli.address, await cli.sign(confidentialKeysMessage()));
    expect(again.elgamalSecretKey).toEqual(keys.elgamalSecretKey);
    expect(again.aeKey).toEqual(keys.aeKey);
    zeroConfidentialKeys(keys);
    expect(keys.elgamalSecretKey.every((byte) => byte === 0)).toBe(true);
    expect(keys.aeKey.every((byte) => byte === 0)).toBe(true);
  });

  it("refuses a signature that is not the wallet's signature of the key message", async () => {
    const cli = await wallet(CLI_SEED);
    const other = await wallet(new Uint8Array(32).fill(9));
    const good = await cli.sign(confidentialKeysMessage());
    const flipped = new Uint8Array(good);
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    const cases: [Address, Uint8Array][] = [
      [cli.address, flipped],
      [cli.address, await cli.sign(new TextEncoder().encode("solana-conf-bal/v2"))],
      [cli.address, await other.sign(confidentialKeysMessage())],
      [other.address, good],
      [cli.address, good.subarray(0, 63)],
    ];
    for (const [signer, signature] of cases) {
      await expect(deriveStandardKeys(signer, signature)).rejects.toBeInstanceOf(
        KeyDerivationError,
      );
    }
  });

  it("I-5 uses keys for an account only if they match its onchain ElGamal key", () => {
    const onchain = address(CLI_ELGAMAL_KEY);
    expect(elgamalKeyMatches(address(CLI_ELGAMAL_KEY), onchain)).toBe(true);
    expect(elgamalKeyMatches(address(CLI_WALLET), onchain)).toBe(false);
    expect(() => assertElGamalKeyMatches(address(CLI_ELGAMAL_KEY), onchain)).not.toThrow();
    expect(() => assertElGamalKeyMatches(address(CLI_WALLET), onchain)).toThrow(KeyMismatchError);
  });
});

describe("signed message check", () => {
  it("accepts exactly the requested bytes signed by the wallet", async () => {
    const cli = await wallet(CLI_SEED);
    const requested = confidentialKeysMessage();
    const signature = await cli.sign(requested);
    expect(
      await checkSignedMessage({
        wallet: cli.address,
        requested,
        signedMessage: requested,
        signature,
      }),
    ).toEqual({ ok: true });
    const prefixed = new TextEncoder().encode("\xffsolana offchain solana-conf-bal/v1");
    expect(
      await checkSignedMessage({
        wallet: cli.address,
        requested,
        signedMessage: prefixed,
        signature: await cli.sign(prefixed),
      }),
    ).toEqual({ ok: false, reason: "message_changed" });
    expect(
      await checkSignedMessage({
        wallet: CLI_ELGAMAL_KEY,
        requested,
        signedMessage: requested,
        signature,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });
});

describe("viewing key", () => {
  it("derives the X25519 keypair of 06 section 2 from the viewing key signature", async () => {
    const cli = await wallet(CLI_SEED);
    expect(new TextDecoder().decode(viewKeyMessage(cli.address))).toBe(
      `sotto-view-key/v1\n${CLI_WALLET}`,
    );
    const signature = await cli.sign(viewKeyMessage(cli.address));
    const keys = await deriveViewingKey(cli.address, signature);

    // Independently: HKDF-SHA256 with salt "sotto" and info "x25519", then libsodium's
    // crypto_box_seed_keypair: secret key = first 32 bytes of SHA-512(seed), public = X25519 base point.
    const seed = Buffer.from(hkdfSync("sha256", signature, "sotto", "x25519", 32));
    const secret = createHash("sha512").update(seed).digest().subarray(0, 32);
    const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), secret]);
    const expectedPublic = createPublicKey(
      createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" }),
    )
      .export({ format: "der", type: "spki" })
      .subarray(-32);
    expect(Buffer.from(keys.secretKey)).toEqual(secret);
    expect(Buffer.from(keys.publicKey)).toEqual(expectedPublic);

    const again = await deriveViewingKey(cli.address, await cli.sign(viewKeyMessage(cli.address)));
    expect(again.publicKey).toEqual(keys.publicKey);
    await expect(
      deriveViewingKey(cli.address, await cli.sign(confidentialKeysMessage())),
    ).rejects.toBeInstanceOf(KeyDerivationError);
  });

  it("I-8 trusts a viewer key only with its registration signature (server substitution)", async () => {
    const viewer = await wallet(CLI_SEED);
    const attacker = await wallet(new Uint8Array(32).fill(7));
    const keys = await deriveViewingKey(
      viewer.address,
      await viewer.sign(viewKeyMessage(viewer.address)),
    );
    const signature = await viewer.sign(viewKeyRegistrationMessage(keys.publicKey));
    expect(new TextDecoder().decode(viewKeyRegistrationMessage(keys.publicKey))).toBe(
      `sotto-view-key-register/v1\n${Buffer.from(keys.publicKey).toString("base64")}`,
    );
    expect(
      await verifyViewKeyRegistration({
        wallet: viewer.address,
        publicKey: keys.publicKey,
        signature,
      }),
    ).toBe(true);

    // A server that swaps in a key it controls cannot produce the viewer's signature for it.
    const swapped = new Uint8Array(32).fill(3);
    expect(
      await verifyViewKeyRegistration({ wallet: viewer.address, publicKey: swapped, signature }),
    ).toBe(false);
    expect(
      await verifyViewKeyRegistration({
        wallet: viewer.address,
        publicKey: swapped,
        signature: await attacker.sign(viewKeyRegistrationMessage(swapped)),
      }),
    ).toBe(false);
    expect(
      await verifyViewKeyRegistration({
        wallet: viewer.address,
        publicKey: keys.publicKey.subarray(0, 31),
        signature,
      }),
    ).toBe(false);
  });
});
