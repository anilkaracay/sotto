// The devnet release run's accounts (step 3.11, 11 section 5): wallet A tops up the founder's fresh
// Solflare accounts for the acceptance scenario, as approved by the founder on 2026-10-02: SOL for
// the owner and the recipient, devnet USDC for the owner; the accountant only signs messages and gets
// nothing. Amounts from the measured runs plus a margin (verified in step 3.11). Read only by
// default: it checks the cluster, the addresses and the balances and prints the plan. With --send
// it simulates each transfer, sends it from wallet A and waits for finalized; it only tops up to
// the target, so a second run sends nothing.
//
//   node scripts/fund-devnet-run.ts <owner> <recipient> <accountant> [--send]
import { getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { getClusterConfig, type AvailableClusterConfig } from "@sotto/sdk/cluster";
import { sendWithKeypairSigners, simulateInstructions } from "@sotto/sdk/tx";
import {
  address,
  fetchEncodedAccount,
  isAddress,
  lamports,
  type Address,
  type Instruction,
} from "@solana/kit";
import { devnetRpc, sottoKeypair } from "./devnet.ts";

const SOL = 1_000_000_000n;
const USDC = 1_000_000n;
const OWNER_SOL = SOL / 10n; // 0.1 SOL
const RECIPIENT_SOL = SOL / 20n; // 0.05 SOL
const OWNER_USDC = 5n * USDC;

const args = process.argv.slice(2);
const send = args.includes("--send");
const roles = args.filter((arg) => arg !== "--send");
if (roles.length !== 3 || !roles.every((value) => isAddress(value))) {
  throw new Error(
    "usage: node scripts/fund-devnet-run.ts <owner> <recipient> <accountant> [--send]",
  );
}
const [owner, recipient, accountant] = roles.map((value) => address(value)) as [
  Address,
  Address,
  Address,
];

const cluster = getClusterConfig("devnet") as AvailableClusterConfig;
if (!cluster.usdcMint) throw new Error("no devnet USDC mint in the cluster config");
const usdcMint = cluster.usdcMint;
const rpc = await devnetRpc();
const walletA = await sottoKeypair("wallet-a.json");

const solOf = async (account: Address) =>
  (await rpc.getBalance(account, { commitment: "confirmed" }).send()).value;
const usdcAccount = async (owner: Address) =>
  (await findAssociatedTokenPda({ owner, mint: usdcMint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
const usdcOf = async (owner: Address) => {
  const account = await usdcAccount(owner);
  if (!(await fetchEncodedAccount(rpc, account, { commitment: "confirmed" })).exists) return 0n;
  return BigInt(
    (await rpc.getTokenAccountBalance(account, { commitment: "confirmed" }).send()).value.amount,
  );
};
const show = (amount: bigint, unit: bigint) => (Number(amount) / Number(unit)).toString();

async function report(when: string) {
  console.log(`${when}:`);
  for (const [name, account] of [
    ["wallet A", walletA.address],
    ["owner", owner],
    ["recipient", recipient],
    ["accountant", accountant],
  ] as const) {
    console.log(
      `  ${name.padEnd(10)} ${account}  ${show(await solOf(account), SOL)} SOL, ${show(await usdcOf(account), USDC)} USDC`,
    );
  }
}

await report("before (devnet, genesis checked)");

const transfers: { name: string; instructions: Instruction[] }[] = [];
for (const [name, account, target] of [
  ["owner SOL", owner, OWNER_SOL],
  ["recipient SOL", recipient, RECIPIENT_SOL],
] as const) {
  const missing = target - (await solOf(account));
  if (missing > 0n) {
    transfers.push({
      name: `${name}: ${show(missing, SOL)} SOL`,
      instructions: [
        getTransferSolInstruction({
          source: walletA,
          destination: account,
          amount: lamports(missing),
        }),
      ],
    });
  }
}
const missingUsdc = OWNER_USDC - (await usdcOf(owner));
if (missingUsdc > 0n) {
  transfers.push({
    name: `owner USDC: ${show(missingUsdc, USDC)} USDC`,
    instructions: [
      getCreateAssociatedTokenIdempotentInstruction({
        payer: walletA,
        ata: await usdcAccount(owner),
        owner,
        mint: usdcMint,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      }),
      getTransferCheckedInstruction({
        source: await usdcAccount(walletA.address),
        mint: usdcMint,
        destination: await usdcAccount(owner),
        authority: walletA,
        amount: missingUsdc,
        decimals: 6,
      }),
    ],
  });
}

if (transfers.length === 0) console.log("nothing to send: every account is at its target");
for (const transfer of transfers) {
  const simulation = await simulateInstructions({
    rpc,
    feePayer: walletA.address,
    instructions: transfer.instructions,
  });
  if (simulation.err) {
    throw new Error(`${transfer.name}: simulation failed, ${JSON.stringify(simulation.err)}`);
  }
  console.log(`${transfer.name}: simulated, ${simulation.unitsConsumed} units`);
  if (!send) continue;
  const sent = await sendWithKeypairSigners({
    rpc,
    feePayer: walletA,
    instructions: transfer.instructions,
    finalize: true,
  });
  console.log(`${transfer.name}: finalized ${sent.signature}`);
}

if (send) await report("after");
else console.log("read only: nothing sent (pass --send to send)");
