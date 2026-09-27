import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { getAddressDecoder } from "@solana/kit";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expandHome, loadKeypairSigner } from "../src/keypair.ts";

function solanaCliKeypair(): { bytes: number[]; address: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const seed = Buffer.from(privateKey.export({ format: "jwk" }).d as string, "base64url");
  const pub = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url");
  return { bytes: [...seed, ...pub], address: getAddressDecoder().decode(pub) };
}

describe("loadKeypairSigner", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sotto-worker-keypair-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads a Solana CLI keypair file", async () => {
    const { bytes, address } = solanaCliKeypair();
    const file = join(dir, "signer.json");
    writeFileSync(file, JSON.stringify(bytes));
    expect((await loadKeypairSigner(file)).address).toBe(address);
  });

  it("names the file but never quotes its contents", async () => {
    const file = join(dir, "broken.json");
    writeFileSync(file, '[12,34,"secret-marker"');
    await expect(loadKeypairSigner(file)).rejects.toThrow(`cannot read the keypair file ${file}`);
    await loadKeypairSigner(file).catch((error: Error) => {
      expect(error.message).not.toContain("secret-marker");
      expect(error.cause).toBeUndefined();
    });
  });

  it("rejects files that are not 64 bytes", async () => {
    const file = join(dir, "short.json");
    writeFileSync(file, JSON.stringify([1, 2, 3]));
    await expect(loadKeypairSigner(file)).rejects.toThrow("is not a 64 byte Solana CLI keypair");
    writeFileSync(file, JSON.stringify(Array.from({ length: 64 }, () => 256)));
    await expect(loadKeypairSigner(file)).rejects.toThrow("is not a 64 byte Solana CLI keypair");
  });

  it("rejects a keypair whose public half does not match", async () => {
    const a = solanaCliKeypair();
    const b = solanaCliKeypair();
    const file = join(dir, "mismatch.json");
    writeFileSync(file, JSON.stringify([...a.bytes.slice(0, 32), ...b.bytes.slice(32)]));
    await expect(loadKeypairSigner(file)).rejects.toThrow();
  });

  it("reports a missing file with its error code", async () => {
    await expect(loadKeypairSigner(join(dir, "missing.json"))).rejects.toThrow("(ENOENT)");
  });

  it("expands a leading ~ to the home directory", () => {
    expect(expandHome("~/.config/solana/x.json")).toBe(join(homedir(), ".config/solana/x.json"));
    expect(expandHome("/abs/x.json")).toBe("/abs/x.json");
  });
});
