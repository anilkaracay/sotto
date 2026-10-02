// Bootstraps a local validator started by scripts/localnet.sh (14 section 4, step 1.6): a USDC-like
// SPL Token mint (6 decimals), its wrapped Token-2022 mint through the Sotto Token Wrap deployment
// that localnet.sh loads, the escrow of unwrapped tokens, and the SAS credential and schema through
// the worker's bootstrap:sas with a throwaway signer (sas-lib stays in apps/worker, D-24), and, when
// its SBF build exists (target/deploy/sotto_proofs.so, cargo-build-sbf --arch v3), the sotto_proofs
// program under a throwaway program keypair with the payer as upgrade authority and its config for
// the wrapped mint (step 2.7). It checks the result with the startup verification (06 section 0) and
// writes .localnet/bootstrap.json. Since step 4.3 (D-29) it does the same for devUSD, the devnet test
// dollar: its own SPL Token mint (6 decimals, no freeze authority) under its own mint authority, as on
// devnet, its wrapped mint and escrow, and a second sotto_proofs deployment for its wrapped mint (a
// config holds one wrapped mint). It refuses any cluster whose genesis hash is devnet's or mainnet's.
// The keypairs it creates hold only localnet SOL and live in .localnet/bootstrap (git ignored).
//
// Usage: node scripts/bootstrap-localnet.ts [--url http://127.0.0.1:8899]
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  getInitializeMint2Instruction,
  getMintSize,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  clusterFromGenesisHash,
  getClusterConfig,
  type AvailableClusterConfig,
} from "@sotto/sdk/cluster";
import { verifyCluster } from "@sotto/sdk/cluster/verify";
import {
  findConfigPda,
  getInitializeConfigInstructionAsync,
  programDataAddress,
} from "@sotto/sdk/proofs";
import {
  createRetryingRpc,
  sendWithKeypairSigners,
  waitForConfirmation,
  type SolanaRpc,
} from "@sotto/sdk/tx";
import { createEscrowInstructions, createWrappedMintInstructions } from "@sotto/sdk/wrap";
import {
  createKeyPairSignerFromBytes,
  generateKeyPairSigner,
  lamports,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const OUT_DIR = join(ROOT, ".localnet", "bootstrap");
const USDC_DECIMALS = 6;

/** A new Ed25519 keypair saved as a Solana keypair file (seed, then public key). */
async function newKeypairFile(name: string): Promise<{ signer: KeyPairSigner; path: string }> {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const bytes = new Uint8Array([
    ...privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32),
    ...publicKey.export({ format: "der", type: "spki" }).subarray(-32),
  ]);
  const path = join(OUT_DIR, name);
  writeFileSync(path, JSON.stringify([...bytes]), { mode: 0o600 });
  const signer = await createKeyPairSignerFromBytes(bytes);
  bytes.fill(0);
  return { signer, path };
}

async function airdrop(rpc: SolanaRpc, to: Address, sol: bigint): Promise<void> {
  await waitForConfirmation(
    rpc,
    await rpc.requestAirdrop(to, lamports(sol * 1_000_000_000n)).send(),
  );
}

/** Runs the worker's bootstrap:sas on localnet and reads the addresses it prints. */
function bootstrapSas(signerPath: string): { credential: Address; schema: Address } {
  const output = execFileSync(
    "pnpm",
    [
      "--silent",
      "--filter",
      "@sotto/worker",
      "bootstrap:sas",
      "--cluster",
      "localnet",
      "--signer",
      signerPath,
    ],
    { cwd: ROOT, encoding: "utf8" },
  );
  const credential = /^credential: (\S+)/m.exec(output)?.[1];
  const schema = /^schema: (\S+)/m.exec(output)?.[1];
  if (!credential || !schema || !output.includes("SAS BOOTSTRAP OK")) {
    throw new Error(`bootstrap:sas did not finish:\n${output}`);
  }
  return { credential: credential as Address, schema: schema as Address };
}

/**
 * Deploys the sotto_proofs build under a new program keypair, the payer as upgrade authority, and
 * creates its config for the wrapped mint. Returns null when the program has not been built.
 */
async function deploySottoProofs(
  rpc: SolanaRpc,
  url: string,
  payer: { signer: KeyPairSigner; path: string },
  wrappedUsdcMint: Address,
  keypairName: string,
): Promise<{ programId: Address; config: Address; programKeypair: string } | null> {
  const so = join(ROOT, "target", "deploy", "sotto_proofs.so");
  if (!existsSync(so)) return null;
  const program = await newKeypairFile(keypairName);
  execFileSync(
    "solana",
    [
      "program",
      "deploy",
      so,
      "--program-id",
      program.path,
      "--keypair",
      payer.path,
      "--upgrade-authority",
      payer.path,
      "--url",
      url,
    ],
    { stdio: "ignore" },
  );
  const programAddress = program.signer.address;
  // A program deployed in a slot runs from the next one ("Program is not deployed" before that).
  const deployed = await rpc.getSlot({ commitment: "confirmed" }).send();
  while ((await rpc.getSlot({ commitment: "confirmed" }).send()) <= deployed + 1n) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const initialize = await getInitializeConfigInstructionAsync(
    {
      authority: payer.signer,
      programData: await programDataAddress(programAddress),
      payer: payer.signer,
      wrappedUsdcMint,
    },
    { programAddress },
  );
  await sendWithKeypairSigners({ rpc, feePayer: payer.signer, instructions: [initialize] });
  const [config] = await findConfigPda({ programAddress });
  return { programId: programAddress, config, programKeypair: program.path };
}

/**
 * An SPL Token mint of 6 decimals under `mintAuthority` (the freeze authority too when `freeze`), its
 * wrapped Token-2022 mint through the cluster's Token Wrap deployment, and the escrow of unwrapped
 * tokens.
 */
async function createAsset(
  rpc: SolanaRpc,
  config: AvailableClusterConfig,
  payer: KeyPairSigner,
  mintAuthority: Address,
  freeze: boolean,
): Promise<{ mint: Address; wrappedMint: Address; escrow: Address }> {
  const mint = await generateKeyPairSigner();
  const space = getMintSize();
  const rent = await rpc.getMinimumBalanceForRentExemption(BigInt(space)).send();
  await sendWithKeypairSigners({
    rpc,
    feePayer: payer,
    instructions: [
      getCreateAccountInstruction({
        payer,
        newAccount: mint,
        lamports: rent,
        space,
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      getInitializeMint2Instruction({
        mint: mint.address,
        decimals: USDC_DECIMALS,
        mintAuthority,
        freezeAuthority: freeze ? mintAuthority : null,
      }),
    ],
  });
  const wrapped = await createWrappedMintInstructions({
    rpc,
    payer,
    unwrappedMint: mint.address,
    programAddress: config.programs.tokenWrap,
  });
  await sendWithKeypairSigners({ rpc, feePayer: payer, instructions: wrapped.instructions });
  const escrow = await createEscrowInstructions({
    rpc,
    payer,
    unwrappedMint: mint.address,
    programAddress: config.programs.tokenWrap,
  });
  await sendWithKeypairSigners({ rpc, feePayer: payer, instructions: escrow.instructions });
  return { mint: mint.address, wrappedMint: wrapped.wrappedMint, escrow: escrow.escrow };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { url: { type: "string", default: "http://127.0.0.1:8899" } },
  });
  const rpc = createRetryingRpc(values.url);
  const genesisHash = await rpc.getGenesisHash().send();
  if (clusterFromGenesisHash(genesisHash) !== "other") {
    throw new Error(`${values.url} serves devnet or mainnet (genesis ${genesisHash}); refused`);
  }
  const config = getClusterConfig("localnet") as AvailableClusterConfig;
  mkdirSync(OUT_DIR, { recursive: true });

  const payer = await newKeypairFile("payer.json");
  await airdrop(rpc, payer.signer.address, 100n);

  // The USDC-like mint: an SPL Token mint like USDC, with the payer as mint and freeze authority.
  const usdc = await createAsset(rpc, config, payer.signer, payer.signer.address, true);
  // devUSD (step 4.3): its own mint authority, which on devnet lives only on the server.
  const devusdAuthority = await newKeypairFile("devusd-mint-authority.json");
  await airdrop(rpc, devusdAuthority.signer.address, 10n);
  const devusd = await createAsset(
    rpc,
    config,
    payer.signer,
    devusdAuthority.signer.address,
    false,
  );
  const wrapped = { wrappedMint: usdc.wrappedMint };
  const escrow = { escrow: usdc.escrow };

  const check = await verifyCluster(rpc, config, {
    usdcMint: usdc.mint,
    wrappedUsdcMint: wrapped.wrappedMint,
  });
  if (!check.confidentialEnabled) {
    throw new Error(`the startup verification failed: ${JSON.stringify(check)}`);
  }
  const devusdCheck = await verifyCluster(rpc, config, {
    usdcMint: devusd.mint,
    wrappedUsdcMint: devusd.wrappedMint,
  });
  if (!devusdCheck.confidentialEnabled) {
    throw new Error(`the startup verification failed for devUSD: ${JSON.stringify(devusdCheck)}`);
  }

  const sasSigner = await newKeypairFile("sas-signer.json");
  const sas = bootstrapSas(sasSigner.path);
  const sottoProofs = await deploySottoProofs(
    rpc,
    values.url,
    payer,
    wrapped.wrappedMint,
    "sotto-proofs-program.json",
  );
  const devusdProofs = await deploySottoProofs(
    rpc,
    values.url,
    payer,
    devusd.wrappedMint,
    "sotto-proofs-devusd-program.json",
  );

  const record = {
    createdAt: new Date().toISOString(),
    rpcUrl: values.url,
    genesisHash,
    payer: { address: payer.signer.address, keypair: payer.path },
    usdcMint: usdc.mint,
    usdcDecimals: USDC_DECIMALS,
    usdcMintAuthority: payer.signer.address,
    tokenWrapProgram: config.programs.tokenWrap,
    wrappedUsdcMint: wrapped.wrappedMint,
    escrow: escrow.escrow,
    sas: { signer: sasSigner.signer.address, signerKeypair: sasSigner.path, ...sas },
    sottoProofs,
    devusd: {
      mint: devusd.mint,
      decimals: USDC_DECIMALS,
      mintAuthority: devusdAuthority.signer.address,
      mintAuthorityKeypair: devusdAuthority.path,
      wrappedMint: devusd.wrappedMint,
      escrow: devusd.escrow,
      sottoProofs: devusdProofs,
    },
    startupCheck: { confidentialEnabled: check.confidentialEnabled, v1: check.v1 },
  };
  writeFileSync(join(ROOT, ".localnet", "bootstrap.json"), `${JSON.stringify(record, null, 2)}\n`);
  console.log(
    `usdc mint:        ${usdc.mint} (${USDC_DECIMALS} decimals, authority ${payer.signer.address})`,
  );
  console.log(
    `devusd mint:      ${devusd.mint} (wrapped ${devusd.wrappedMint}, authority ${devusdAuthority.signer.address})`,
  );
  console.log(`wrapped mint:     ${wrapped.wrappedMint} (Token Wrap ${config.programs.tokenWrap})`);
  console.log(`escrow:           ${escrow.escrow}`);
  console.log(`sas credential:   ${sas.credential}`);
  console.log(`sas schema:       ${sas.schema}`);
  console.log(
    sottoProofs
      ? `sotto_proofs:     ${sottoProofs.programId} (config ${sottoProofs.config})`
      : "sotto_proofs:     not built (target/deploy/sotto_proofs.so), not deployed",
  );
  console.log(
    devusdProofs
      ? `devusd proofs:    ${devusdProofs.programId} (config ${devusdProofs.config})`
      : "devusd proofs:    not built, not deployed",
  );
  console.log(`startup check:    confidential enabled, v1 ${check.v1 ? "yes" : "no"}`);
  console.log("LOCALNET BOOTSTRAP OK (.localnet/bootstrap.json)");
}

await main();
