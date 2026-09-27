// Loads a Solana CLI keypair file (a JSON array of 64 bytes) as a kit signer. Errors name the file,
// never its contents.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit";

export function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? homedir() + path.slice(1) : path;
}

export async function loadKeypairSigner(path: string): Promise<KeyPairSigner> {
  const file = expandHome(path);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // The cause is left out on purpose: a JSON.parse error quotes the file, which holds a secret key.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`cannot read the keypair file ${file}${code ? ` (${code})` : ""}`);
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 64 ||
    !parsed.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    throw new Error(`the keypair file ${file} is not a 64 byte Solana CLI keypair`);
  }
  return createKeyPairSignerFromBytes(new Uint8Array(parsed as number[]));
}
