// SAS bootstrap and Gate G5 (08 section 5, 14 section 4). Creates the Sotto credential and the
// sotto.business.v1 schema when they are missing. With --test-attestation <owner> it also checks the
// attestation address derivation, issues a test attestation with nonce = owner, reads it back and
// closes it. Safe to run again. Writes to devnet or localnet only (D-01): the RPC endpoint's genesis
// hash must match --cluster, and mainnet is refused. Prints addresses and signatures, never the RPC
// URL.
//
//   pnpm --filter @sotto/worker bootstrap:sas --cluster devnet [--test-attestation <owner>]
//   pnpm --filter @sotto/worker bootstrap:sas --cluster localnet [--test-attestation <owner>] [--signer <keypair>]
//
// devnet reads RPC_URL and SAS_SIGNER_KEYPAIR from apps/worker/.env.local; localnet uses
// http://127.0.0.1:8899 and airdrops to the signer when it is low.
import { lamports, type Address } from "@solana/kit";
import { clusterFromGenesisHash } from "@sotto/sdk/cluster";
import { createRetryingRpc, SimulationFailedError, waitForConfirmation } from "@sotto/sdk/tx";
import { parseCli } from "../bootstrap-cli.ts";
import { parseRpcUrl, readSasConfig } from "../config.ts";
import { loadLocalEnv } from "../env.ts";
import { loadKeypairSigner } from "../keypair.ts";
import { redact } from "../redact.ts";
import {
  attestationExpiry,
  LEVEL_MANUAL_REVIEW,
  type BusinessAttestation,
} from "../sas/business-schema.ts";
import {
  checkAttestationDerivation,
  closeAttestation,
  ensureBusinessSchema,
  ensureCredential,
  issueBusinessAttestation,
  readBusinessAttestation,
  SAS_ERROR_NAMES,
  SAS_INVALID_ATTESTATION,
} from "../sas/client.ts";
import { SAS_PROGRAM_ADDRESS } from "../sas/sas-lib-boundary.ts";

export const LOCALNET_RPC_URL = "http://127.0.0.1:8899";
/** Enough for the credential, schema and attestation rent plus fees (about 0.007 SOL on devnet). */
const MIN_SIGNER_LAMPORTS = 20_000_000n;
const LOCALNET_AIRDROP_LAMPORTS = 2_000_000_000n;

const secrets: string[] = [];

function json(value: unknown): string {
  return JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v));
}

function sol(value: bigint): string {
  return `${value / 1_000_000_000n}.${(value % 1_000_000_000n).toString().padStart(9, "0")}`;
}

function checkConfiguredAddress(name: string, configured: Address | null, derived: Address): void {
  if (configured === null) {
    console.log(`  ${name} is not set in apps/worker/.env.local; the bootstrap derived ${derived}`);
  } else if (configured !== derived) {
    throw new Error(`${name} is ${configured} but the bootstrap derived ${derived}`);
  } else {
    console.log(`  ${name} in apps/worker/.env.local matches`);
  }
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2));
  loadLocalEnv();
  const sasConfig = readSasConfig();
  const rpcUrl = cli.cluster === "devnet" ? parseRpcUrl(process.env.RPC_URL) : LOCALNET_RPC_URL;
  secrets.push(rpcUrl);
  const rpc = createRetryingRpc(rpcUrl, {
    onRetry: (retry, max, delay) =>
      console.log(`network busy, retrying (${retry} of ${max}) in ${delay / 1000} s`),
  });

  const genesisHash = await rpc.getGenesisHash().send();
  const served = clusterFromGenesisHash(genesisHash);
  if (served === "mainnet") throw new Error("the RPC endpoint serves mainnet; refused (D-01)");
  if (cli.cluster === "devnet" && served !== "devnet") {
    throw new Error(`RPC_URL does not serve devnet (genesis ${genesisHash})`);
  }
  if (cli.cluster === "localnet" && served !== "other") {
    throw new Error(`${LOCALNET_RPC_URL} does not serve a local ledger (genesis ${genesisHash})`);
  }
  console.log(`cluster: ${cli.cluster} (genesis ${genesisHash})`);

  const program = await rpc.getAccountInfo(SAS_PROGRAM_ADDRESS, { encoding: "base64" }).send();
  if (!program.value?.executable) {
    throw new Error(`the SAS program ${SAS_PROGRAM_ADDRESS} is not loaded on this cluster`);
  }
  console.log(`sas program: ${SAS_PROGRAM_ADDRESS} (executable)`);

  const signerPath = cli.signer ?? sasConfig.sasSignerKeypair;
  if (!signerPath) throw new Error("SAS_SIGNER_KEYPAIR is not set");
  const signer = await loadKeypairSigner(signerPath);
  let { value: balance } = await rpc.getBalance(signer.address, { commitment: "confirmed" }).send();
  if (balance < MIN_SIGNER_LAMPORTS) {
    if (cli.cluster !== "localnet") {
      throw new Error(
        `the SAS signer ${signer.address} holds ${sol(balance)} SOL; fund it with at least ${sol(MIN_SIGNER_LAMPORTS)} devnet SOL`,
      );
    }
    const airdrop = await rpc
      .requestAirdrop(signer.address, lamports(LOCALNET_AIRDROP_LAMPORTS))
      .send();
    await waitForConfirmation(rpc, airdrop);
    ({ value: balance } = await rpc.getBalance(signer.address, { commitment: "confirmed" }).send());
  }
  console.log(`sas signer: ${signer.address} (${sol(balance)} SOL)`);

  const ctx = { rpc, signer };
  const credential = await ensureCredential(ctx);
  console.log(
    `credential: ${credential.address} ${credential.signature ? `created, signature ${credential.signature}` : "exists"}`,
  );
  console.log(
    `  authority ${credential.account.authority}; authorized signers ${credential.account.authorizedSigners.join(", ")}`,
  );
  const schema = await ensureBusinessSchema(ctx, credential.address);
  console.log(
    `schema: ${schema.address} ${schema.signature ? `created, signature ${schema.signature}` : "exists"}`,
  );
  console.log(
    `  name ${schema.account.name}; version ${schema.account.version}; layout [${schema.account.layout.join(", ")}]; fields ${schema.account.fieldNames.join(", ")}; paused ${schema.account.isPaused}`,
  );
  if (cli.cluster === "devnet") {
    checkConfiguredAddress(
      "SAS_CREDENTIAL_ADDRESS",
      sasConfig.sasCredentialAddress,
      credential.address,
    );
    checkConfiguredAddress("SAS_SCHEMA_ADDRESS", sasConfig.sasSchemaAddress, schema.address);
  }

  if (cli.testOwner) {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const data: BusinessAttestation = {
      org_id: "g5-test",
      legal_name: "G5 test business",
      country: "ZZ",
      verified_at: now,
      level: LEVEL_MANUAL_REVIEW,
    };
    const input = {
      credential: credential.address,
      schema,
      owner: cli.testOwner,
      data,
      expiry: attestationExpiry(now),
    };
    const derivation = await checkAttestationDerivation(ctx, input);
    if (derivation.sasLib !== derivation.independent) {
      throw new Error(
        `sas-lib derives ${derivation.sasLib} but the seeds [attestation, credential, schema, nonce] give ${derivation.independent}; stop and ask (08 section 5)`,
      );
    }
    if (!derivation.wrongAddressRejectedByPdaCheck) {
      throw new Error(
        `a create at ${derivation.wrongAddress}, an address derived for another nonce, did not fail with InvalidAttestation (simulation error ${json(derivation.wrongAddressSimulation.err)}); stop and ask (08 section 5)`,
      );
    }
    console.log(
      `derivation: sas-lib ${derivation.sasLib} equals the seeds [attestation, credential, schema, nonce]`,
    );
    console.log(
      `derivation: a create at ${derivation.wrongAddress} (derived for nonce = credential) fails in simulation with custom error ${SAS_INVALID_ATTESTATION}, ${SAS_ERROR_NAMES[SAS_INVALID_ATTESTATION]} (the PDA check)`,
    );
    for (const line of derivation.wrongAddressSimulation.logs.filter((l) => /failed/i.test(l))) {
      console.log(`  log: ${line}`);
    }

    const issued = await issueBusinessAttestation(ctx, input);
    if (issued.address !== derivation.sasLib) {
      throw new Error(`attestation created at ${issued.address}, expected ${derivation.sasLib}`);
    }
    console.log(`attestation: ${issued.address} issued, signature ${issued.signature}`);

    const read = await readBusinessAttestation(rpc, issued.address, schema.account);
    if (!read) throw new Error(`attestation ${issued.address} was not found after it was issued`);
    const mismatches: string[] = [];
    if (read.account.nonce !== cli.testOwner) mismatches.push("nonce");
    if (read.account.credential !== credential.address) mismatches.push("credential");
    if (read.account.schema !== schema.address) mismatches.push("schema");
    if (read.account.signer !== signer.address) mismatches.push("signer");
    if (read.account.expiry !== input.expiry) mismatches.push("expiry");
    if (json(read.data) !== json(data)) mismatches.push("data");
    if (mismatches.length > 0) {
      throw new Error(`attestation read back differs in: ${mismatches.join(", ")}`);
    }
    console.log(
      `  read back: nonce ${read.account.nonce}; signer ${read.account.signer}; expiry ${read.account.expiry}; token account ${read.account.tokenAccount}; data ${json(read.data)}`,
    );

    const closed = await closeAttestation(ctx, {
      credential: credential.address,
      attestation: issued.address,
    });
    console.log(`attestation: ${issued.address} closed, signature ${closed}`);
  }
  console.log(cli.testOwner ? "G5 PASSED" : "SAS BOOTSTRAP OK");
}

main().then(
  () => {
    process.exitCode = 0;
  },
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: ${redact(message, secrets)}`);
    if (error instanceof SimulationFailedError) {
      for (const line of error.logs.slice(-12)) console.error(`  log: ${redact(line, secrets)}`);
    }
    process.exitCode = 1;
  },
);
