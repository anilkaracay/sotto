// Shared by the devnet scripts (step 2.7): the RPC endpoint from apps/worker/.env.local, read with
// Node's env file parser so the file wins over any shell variable (ENGINEERING-RULES.md, local configuration),
// and never printed; a devnet genesis check; and keypair files outside the repository.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { GENESIS_HASHES } from "@sotto/sdk/cluster";
import { createRetryingRpc, type SolanaRpc } from "@sotto/sdk/tx";
import { createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit";

const WORKER_ENV = fileURLToPath(new URL("../apps/worker/.env.local", import.meta.url));

/** A devnet RPC client on the endpoint of apps/worker/.env.local; refuses any other cluster. */
export async function devnetRpc(): Promise<SolanaRpc> {
  const url = parseEnv(readFileSync(WORKER_ENV, "utf8")).RPC_URL;
  if (!url) throw new Error("apps/worker/.env.local has no RPC_URL");
  const rpc = createRetryingRpc(url);
  if ((await rpc.getGenesisHash().send()) !== GENESIS_HASHES.devnet) {
    throw new Error("the RPC_URL of apps/worker/.env.local does not serve devnet; refused");
  }
  return rpc;
}

/** A keypair file in ~/.config/solana/sotto, by name. */
export async function sottoKeypair(name: string): Promise<KeyPairSigner> {
  const path = join(homedir(), ".config", "solana", "sotto", name);
  const bytes = new Uint8Array(JSON.parse(readFileSync(path, "utf8")) as number[]);
  const signer = await createKeyPairSignerFromBytes(bytes);
  bytes.fill(0);
  return signer;
}
