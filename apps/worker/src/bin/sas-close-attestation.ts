// Closes the Sotto attestation of an owner wallet on devnet (step 1.6), for example before demo
// seeding. Run it through scripts/sas-close-attestation.ts or directly:
//
//   pnpm --filter @sotto/worker sas:close-attestation --owner <wallet>
//
// It reads RPC_URL, SAS_SIGNER_KEYPAIR, SAS_CREDENTIAL_ADDRESS and SAS_SCHEMA_ADDRESS from
// apps/worker/.env.local, refuses mainnet and any RPC whose genesis hash is not devnet's, prints the
// attestation address and sends only after the operator types yes. It never prints the RPC URL.
import { createInterface } from "node:readline/promises";
import { createRetryingRpc } from "@sotto/sdk/tx";
import { parseRpcUrl, readSasConfig } from "../config.ts";
import { loadLocalEnv } from "../env.ts";
import { loadKeypairSigner } from "../keypair.ts";
import { redact } from "../redact.ts";
import { assertDevnet, closeOwnerAttestation, findOwnerAttestation } from "../sas/close.ts";
import { parseCloseCli } from "../sas-close-cli.ts";

const secrets: string[] = [];

async function ask(question: string): Promise<string> {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await terminal.question(question);
  } finally {
    terminal.close();
  }
}

async function main(): Promise<void> {
  const cli = parseCloseCli(process.argv.slice(2));
  loadLocalEnv();
  const rpcUrl = parseRpcUrl(process.env.RPC_URL);
  secrets.push(rpcUrl);
  const sas = readSasConfig();
  if (!sas.sasSignerKeypair || !sas.sasCredentialAddress || !sas.sasSchemaAddress) {
    throw new Error(
      "SAS_SIGNER_KEYPAIR, SAS_CREDENTIAL_ADDRESS and SAS_SCHEMA_ADDRESS must be set",
    );
  }
  const rpc = createRetryingRpc(rpcUrl, {
    onRetry: (retry, max, delay) =>
      console.log(`network busy, retrying (${retry} of ${max}) in ${delay / 1000} s`),
  });
  assertDevnet(await rpc.getGenesisHash().send());
  const input = {
    credential: sas.sasCredentialAddress,
    schema: sas.sasSchemaAddress,
    owner: cli.owner,
  };
  const found = await findOwnerAttestation(rpc, input);
  console.log(`cluster: devnet`);
  console.log(`attestation: ${found.attestation} (owner ${cli.owner})`);
  if (!found.exists) {
    console.log("No attestation exists at this address; nothing to close.");
    return;
  }
  const answer = await ask("Close this attestation on devnet? Type yes to send: ");
  if (answer.trim() !== "yes") {
    console.log("Not sent.");
    return;
  }
  const signer = await loadKeypairSigner(sas.sasSignerKeypair);
  const closed = await closeOwnerAttestation({ rpc, signer }, input);
  console.log(`closed, signature ${closed.signature}`);
}

main().catch((error: unknown) => {
  console.error(
    `error: ${redact(error instanceof Error ? error.message : String(error), secrets)}`,
  );
  process.exitCode = 1;
});
