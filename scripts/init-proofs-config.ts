// Creates the sotto_proofs config on devnet for the devnet wrapped USDC mint (step 2.7). It checks that the endpoint serves devnet, that the program's ProgramData account names
// wallet A as its upgrade authority (the only signer initialize_config accepts, D-16) and that no
// config exists yet, simulates, sends, and reads the config back. Wallet A signs and pays. Step 4.3
// (D-29): with --program and --wrapped-mint it creates the config of the second deployment, for the
// wrapped devUSD mint, before the registry names them.
//
// Usage: node scripts/init-proofs-config.ts --cluster devnet [--program <id> --wrapped-mint <mint>]
import { parseArgs } from "node:util";
import { getClusterConfig, type AvailableClusterConfig } from "@sotto/sdk/cluster";
import {
  fetchConfig,
  getInitializeConfigInstructionAsync,
  programDataAddress,
} from "@sotto/sdk/proofs";
import { sendWithKeypairSigners, simulateInstructions } from "@sotto/sdk/tx";
import { address, fetchEncodedAccount, getAddressDecoder } from "@solana/kit";
import { findConfigPda } from "@sotto/sdk/proofs";
import { devnetRpc, sottoKeypair } from "./devnet.ts";

const { values } = parseArgs({
  options: {
    cluster: { type: "string" },
    program: { type: "string" },
    "wrapped-mint": { type: "string" },
  },
});
if (values.cluster !== "devnet") throw new Error("only --cluster devnet is supported");
const cluster = getClusterConfig("devnet") as AvailableClusterConfig;
if (!cluster.sottoProofs || !cluster.wrappedUsdcMint)
  throw new Error("no devnet sotto_proofs config");
const second = values.program !== undefined || values["wrapped-mint"] !== undefined;
if (second && (!values.program || !values["wrapped-mint"])) {
  throw new Error("--program and --wrapped-mint go together");
}
const program = second ? address(values.program as string) : cluster.sottoProofs.program;
const config = second
  ? (await findConfigPda({ programAddress: program }))[0]
  : cluster.sottoProofs.config;
const wrappedMint = second ? address(values["wrapped-mint"] as string) : cluster.wrappedUsdcMint;

const rpc = await devnetRpc();
const authority = await sottoKeypair("wallet-a.json");

// The ProgramData header: u32 tag 3, the slot, then Option<Address> (facts M4).
const programData = await programDataAddress(program);
const header = await fetchEncodedAccount(rpc, programData, { commitment: "finalized" });
if (!header.exists) throw new Error(`${program} is not deployed`);
const data = new Uint8Array(header.data);
const upgradeAuthority = data[12] === 1 ? getAddressDecoder().decode(data.subarray(13, 45)) : null;
if (upgradeAuthority !== authority.address) {
  throw new Error(`the upgrade authority is ${upgradeAuthority}, not ${authority.address}`);
}
if ((await fetchEncodedAccount(rpc, config, { commitment: "finalized" })).exists) {
  throw new Error(`the config ${config} exists already`);
}

const instruction = await getInitializeConfigInstructionAsync(
  { authority, programData, payer: authority, wrappedUsdcMint: wrappedMint },
  { programAddress: program },
);
if (instruction.accounts[0]?.address !== config) throw new Error("unexpected config address");
const simulation = await simulateInstructions({
  rpc,
  feePayer: authority.address,
  instructions: [instruction],
});
if (simulation.err !== null) throw new Error(`simulation failed: ${JSON.stringify(simulation)}`);
const sent = await sendWithKeypairSigners({
  rpc,
  feePayer: authority,
  instructions: [instruction],
});
const stored = await fetchConfig(rpc, config, { commitment: "confirmed" });
console.log(`config:            ${config}`);
console.log(`signature:         ${sent.signature}`);
console.log(`admin:             ${stored.data.admin}`);
console.log(`wrapped mint:      ${stored.data.wrappedUsdcMint}`);
console.log(`paused:            ${stored.data.paused}, bump ${stored.data.bump}`);
if (
  stored.data.admin !== authority.address ||
  stored.data.wrappedUsdcMint !== wrappedMint ||
  stored.data.paused
) {
  throw new Error("the config read back is not the one sent");
}
console.log("CONFIG OK");
