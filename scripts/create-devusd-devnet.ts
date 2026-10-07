// Creates devUSD on devnet (step 4.3, D-29): "Sotto Devnet Test Dollar", a classic SPL Token mint of 6
// decimals whose mint authority is the key the operator's `devusd-keygen` command made on the hosting server (its
// public key is the --authority argument; the secret key never leaves the server) and which has no
// freeze authority; then its wrapped Token-2022 mint and its escrow through the Sotto Token Wrap test
// deployment (D-01). Wallet A pays. Without --send it only simulates each transaction and prints the
// addresses and the rent; with --send it simulates, sends, waits for finality and writes the record
// to ~/.config/solana/sotto/devusd-devnet.json (mode 600, outside the repository). The mint keypair is
// kept next to it (it signs only its own creation).
//
// Usage: node scripts/create-devusd-devnet.ts --authority <server public key> [--send]
import { generateKeyPairSync } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  getInitializeMint2Instruction,
  getMintSize,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { getClusterConfig, type AvailableClusterConfig } from "@sotto/sdk/cluster";
import { sendWithKeypairSigners, simulateInstructions, type SolanaRpc } from "@sotto/sdk/tx";
import {
  createEscrowInstructions,
  createWrappedMintInstructions,
  wrappedMintAddress,
} from "@sotto/sdk/wrap";
import { address, isAddress, type Instruction, type KeyPairSigner } from "@solana/kit";
import { devnetRpc, sottoKeypair } from "./devnet.ts";

const DECIMALS = 6;
const DIR = join(homedir(), ".config", "solana", "sotto");
const MINT_KEYPAIR = join(DIR, "devusd-mint.json");
const RECORD = join(DIR, "devusd-devnet.json");

const { values } = parseArgs({
  options: { authority: { type: "string" }, send: { type: "boolean", default: false } },
});
if (!values.authority || !isAddress(values.authority)) {
  throw new Error(
    "--authority must be the public key the operator's devusd-keygen command printed",
  );
}
if (existsSync(RECORD)) throw new Error(`${RECORD} exists: devUSD was created already`);
const authority = address(values.authority);
const config = getClusterConfig("devnet") as AvailableClusterConfig;
const rpc = await devnetRpc();
const walletA = await sottoKeypair("wallet-a.json");

/**
 * The mint's keypair, made once (mode 600) and kept, so the plan's simulation and the send use the
 * same address. It holds no funds and signs only the mint's creation.
 */
async function mintSigner(): Promise<KeyPairSigner> {
  if (!existsSync(MINT_KEYPAIR)) {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const bytes = [
      ...privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32),
      ...publicKey.export({ format: "der", type: "spki" }).subarray(-32),
    ];
    writeFileSync(MINT_KEYPAIR, `${JSON.stringify(bytes)}\n`, { mode: 0o600, flag: "wx" });
  }
  return sottoKeypair("devusd-mint.json");
}

async function step(name: string, instructions: readonly Instruction[]) {
  const simulation = await simulateInstructions({
    rpc,
    feePayer: walletA.address,
    instructions,
  });
  if (simulation.err !== null)
    throw new Error(`${name}: simulation failed: ${JSON.stringify(simulation)}`);
  console.log(`${name}: simulated, ${simulation.unitsConsumed} compute units`);
  if (!values.send) return null;
  const sent = await sendWithKeypairSigners({
    rpc,
    feePayer: walletA,
    instructions,
    finalize: true,
  });
  console.log(`${name}: ${sent.signature}`);
  return sent.signature;
}

async function rent(rpcClient: SolanaRpc, size: number): Promise<bigint> {
  return rpcClient.getMinimumBalanceForRentExemption(BigInt(size)).send();
}

const mint = await mintSigner();
const space = getMintSize();
const mintRent = await rent(rpc, space);
console.log(`devUSD mint:       ${mint.address} (6 decimals, authority ${authority}, no freeze)`);
const createMint = await step("create the mint", [
  getCreateAccountInstruction({
    payer: walletA,
    newAccount: mint,
    lamports: mintRent,
    space,
    programAddress: TOKEN_PROGRAM_ADDRESS,
  }),
  getInitializeMint2Instruction({
    mint: mint.address,
    decimals: DECIMALS,
    mintAuthority: authority,
    freezeAuthority: null,
  }),
]);
if (!values.send) {
  // The wrap's simulation needs the mint onchain; without --send the rest is the plan's arithmetic.
  const wrappedPreview = await wrappedMintAddress(mint.address, config.programs.tokenWrap);
  console.log(`wrapped devUSD:    ${wrappedPreview} (derived under ${config.programs.tokenWrap})`);
  console.log(
    `rent: mint ${mintRent} lamports; the wrapped mint and the escrow follow with --send`,
  );
  process.exit(0);
}
const wrapped = await createWrappedMintInstructions({
  rpc,
  payer: walletA,
  unwrappedMint: mint.address,
  programAddress: config.programs.tokenWrap,
});
const wrap = await step("create the wrapped mint", wrapped.instructions);
const escrow = await createEscrowInstructions({
  rpc,
  payer: walletA,
  unwrappedMint: mint.address,
  programAddress: config.programs.tokenWrap,
});
const escrowSignature = await step("create the escrow", escrow.instructions);
const record = {
  createdAt: new Date().toISOString(),
  mint: mint.address,
  decimals: DECIMALS,
  mintAuthority: authority,
  freezeAuthority: null,
  wrappedMint: wrapped.wrappedMint,
  escrow: escrow.escrow,
  tokenWrapProgram: config.programs.tokenWrap,
  signatures: { createMint, wrap, escrow: escrowSignature },
};
writeFileSync(RECORD, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(record, null, 2));
