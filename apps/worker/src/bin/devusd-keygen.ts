// Creates the devUSD mint authority's keypair (step 4.3, D-29) on the hosting server, through
// `sotto-compose devusd-keygen`: a new Ed25519 keypair as a Solana keypair file (mode 600) at the
// given path, refused if the file exists. It prints only the public key; the secret key never leaves
// the file, which never leaves the server.
//
//   node apps/worker/src/bin/devusd-keygen.ts <path>
import { generateKeyPairSync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { getAddressDecoder } from "@solana/kit";

const path = process.argv[2];
if (!path) {
  console.error("usage: devusd-keygen.ts <path>");
  process.exit(1);
}
if (existsSync(path)) {
  console.error(`refused: ${path} exists; the mint authority is created once`);
  process.exit(1);
}
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const seed = privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32);
const pub = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
writeFileSync(path, `${JSON.stringify([...seed, ...pub])}\n`, { mode: 0o600, flag: "wx" });
console.log(`devUSD mint authority: ${getAddressDecoder().decode(new Uint8Array(pub))}`);
