// Prints the exact confidential balance of a token account from its owner's keypair file (/app/recovery,
// 10 section 2 mitigation 3). It derives the standard_v1 keys on this computer (the keys the spl-token
// CLI derives for the same keypair, facts A11), reads the account, checks that the keys match its
// ElGamal key (I-5), decrypts the available balance with the AES key and the pending balance with the
// ElGamal key, and prints the spl-token commands with the exact amount. It sends nothing: no
// transaction, and no signature or key leaves this process; the RPC only receives account reads.
//
// Usage: node scripts/recover-balance.ts --keypair <file> (--account <token account> | --mint <mint>)
//        [--url devnet | localnet | <RPC URL>]      (default devnet)
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import {
  associatedTokenAccount,
  ConfidentialAccountError,
  formatTokenAmount,
  readConfidentialBalance,
} from "@sotto/sdk/confidential";
import { confidentialKeysMessage, deriveStandardKeys, zeroConfidentialKeys } from "@sotto/sdk/keys";
import {
  address,
  createKeyPairSignerFromBytes,
  createSignableMessage,
  createSolanaRpc,
  isAddress,
} from "@solana/kit";

const MONIKERS: Record<string, string> = {
  devnet: "https://api.devnet.solana.com",
  localnet: "http://127.0.0.1:8899",
};

const USAGE =
  "usage: node scripts/recover-balance.ts --keypair <file> (--account <token account> | --mint <mint>) [--url devnet | localnet | <RPC URL>]";

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      keypair: { type: "string" },
      account: { type: "string" },
      mint: { type: "string" },
      url: { type: "string", default: "devnet" },
    },
  });
  if (!values.keypair || (!values.account && !values.mint) || (values.account && values.mint)) {
    fail(USAGE);
  }
  const url = MONIKERS[values.url] ?? values.url;
  if (!/^https?:\/\//.test(url)) fail(`--url must be devnet, localnet or an http(s) URL`);
  for (const [name, value] of [
    ["--account", values.account],
    ["--mint", values.mint],
  ] as const) {
    if (value && !isAddress(value)) fail(`${name} is not a Solana address`);
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(JSON.parse(readFileSync(values.keypair, "utf8")) as number[]);
  } catch {
    fail(`cannot read the keypair file ${values.keypair}`);
  }
  if (bytes.length !== 64) fail(`${values.keypair} is not a 64 byte Solana keypair file`);
  const signer = await createKeyPairSignerFromBytes(bytes);
  bytes.fill(0);

  // The key message is signed here, with the keypair, exactly as a wallet signs it for Sotto.
  const [signatures] = await signer.signMessages([
    createSignableMessage(confidentialKeysMessage()),
  ]);
  const signature = new Uint8Array(signatures?.[signer.address] ?? new Uint8Array(0));
  const keys = await deriveStandardKeys(signer.address, signature);
  signature.fill(0);

  try {
    const rpc = createSolanaRpc(url);
    const token = values.account
      ? address(values.account)
      : await associatedTokenAccount(signer.address, address(values.mint as string));
    const balance = await readConfidentialBalance({ rpc, token, owner: signer.address, keys });
    const amount = (units: bigint) => formatTokenAmount(units, balance.decimals);
    const where = balance.associated ? "" : ` --address ${balance.token}`;
    console.log(`Wallet             ${balance.owner}`);
    console.log(
      `Token account      ${balance.token}${balance.associated ? " (associated token account)" : ""}`,
    );
    console.log(`Mint               ${balance.mint} (${balance.decimals} decimals)`);
    console.log(
      `Available balance  ${amount(balance.available)} (${balance.available} base units)`,
    );
    console.log(
      `Pending balance    ${amount(balance.pending)} (${balance.pending} base units, ${balance.pendingCredits} pending credits)`,
    );
    console.log("");
    if (balance.pending > 0n) {
      console.log(
        "First move the pending balance into the available balance, then run this again:",
      );
      console.log(`  spl-token apply-pending-balance ${balance.mint}${where}`);
    } else if (balance.available > 0n) {
      console.log("Move the available balance to your public balance:");
      console.log(
        `  spl-token withdraw-confidential-tokens ${balance.mint} ${amount(balance.available)}${where}`,
      );
    } else {
      console.log("Nothing to withdraw: the confidential balance is 0.");
    }
  } catch (error) {
    if (error instanceof ConfidentialAccountError) fail(error.message);
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    zeroConfidentialKeys(keys);
  }
}

await main();
