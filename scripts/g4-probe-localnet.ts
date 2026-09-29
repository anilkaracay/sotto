// Gate G4 on a local validator (step 2.2, docs/12-MILESTONES.md): measures the compute units of the
// checks 4 to 9 of sotto_proofs::verify_balance_threshold (05 section 4.3) with real proofs. It sets
// up an owner with a confidential wUSDC balance, builds the proofs of "available balance at least X"
// with the token-2022 withdraw proof builder (the same statement: an equality proof over the
// available balance minus X and a 64 bit batched range proof over the same commitment, facts A18),
// verifies them into two context state accounts owned by the owner, deploys the probe program
// (programs/g4_probe, built with cargo-build-sbf) to the local validator and runs it: once with X
// (passes) and once with X + 1 (the onchain subtraction no longer matches). It closes the context
// accounts afterwards. It refuses any cluster whose genesis hash is devnet's or mainnet's; every
// keypair it creates holds only localnet SOL and lives in .localnet/g4 (git ignored).
//
// Usage: node scripts/g4-probe-localnet.ts [--url http://127.0.0.1:8899]
// Needs: scripts/localnet.sh running, node scripts/bootstrap-localnet.ts, and
// cargo-build-sbf --manifest-path programs/g4_probe/Cargo.toml --arch v3 -- --locked (the local
// validator enforces SIMD-0500: new deployments must be SBPF v3)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { clusterFromGenesisHash } from "@sotto/sdk/cluster";
import {
  closeProofAccounts,
  confidentialWithdrawPlan,
  decodeToken2022Account,
  decryptTokenAccount,
} from "@sotto/sdk/confidential";
import {
  applyLocalnetPending,
  fundLocalnetAccount,
  newLocalnetOwner,
  readLocalnetBootstrap,
  setUpLocalnetAccount,
} from "@sotto/sdk/testing/localnet";
import {
  createRetryingRpc,
  sendWithWallet,
  simulateInstructions,
  fromPortableInstruction,
} from "@sotto/sdk/tx";
import {
  AccountRole,
  address,
  fetchEncodedAccount,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type SignatureBytes,
  type Transaction,
} from "@solana/kit";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const USDC = 1_000_000n;
const THRESHOLD = 7n * USDC;

const { values } = parseArgs({ options: { url: { type: "string" } } });
const url = values.url ?? "http://127.0.0.1:8899";
const rpc = createRetryingRpc(url);
if (clusterFromGenesisHash(await rpc.getGenesisHash().send()) !== "other") {
  throw new Error("refusing: this is not a local validator");
}
const bootstrap = readLocalnetBootstrap(join(ROOT, ".localnet/bootstrap.json"));

/** The plan's accounts sign the transactions that need them, over the message the owner signed. */
function cosigner(signers: readonly KeyPairSigner[]) {
  return async (transaction: Transaction): Promise<Record<Address, SignatureBytes>> => {
    const signatures: Record<Address, SignatureBytes> = {};
    for (const signer of signers) {
      if (!(signer.address in transaction.signatures)) continue;
      const [dictionary] = await signer.signTransactions([
        transaction as Parameters<KeyPairSigner["signTransactions"]>[0][number],
      ]);
      const signature = dictionary?.[signer.address];
      if (signature) signatures[signer.address] = signature;
    }
    return signatures;
  };
}

// 1. The probe program on the local validator, from a throwaway payer.
const dir = join(ROOT, ".localnet/g4");
mkdirSync(dir, { recursive: true });
const payerFile = join(dir, "payer.json");
if (!existsSync(payerFile)) {
  execFileSync("solana-keygen", ["new", "--no-bip39-passphrase", "--silent", "-o", payerFile]);
}
execFileSync("solana", ["airdrop", "50", "--keypair", payerFile, "--url", url], {
  stdio: "ignore",
});
const so = join(ROOT, "target/deploy/g4_probe.so");
const programKeypair = join(ROOT, "target/deploy/g4_probe-keypair.json");
execFileSync(
  "solana",
  ["program", "deploy", so, "--program-id", programKeypair, "--keypair", payerFile, "--url", url],
  { stdio: "ignore" },
);
const probe = address(
  execFileSync("solana-keygen", ["pubkey", programKeypair], { encoding: "utf8" }).trim(),
);

// 2. An owner with 10 wUSDC available.
const owner = await newLocalnetOwner(rpc, bootstrap, 20n);
await setUpLocalnetAccount(rpc, owner, bootstrap);
await fundLocalnetAccount(rpc, owner, bootstrap, 10n * USDC);
await applyLocalnetPending(rpc, owner);
const read = async () => {
  const account = await fetchEncodedAccount(rpc, owner.wusdc as Address, {
    commitment: "confirmed",
  });
  if (!account.exists) throw new Error("the owner's wUSDC account does not exist");
  return decodeToken2022Account(new Uint8Array(account.data));
};
const tokenAccount = await read();
const available = decryptTokenAccount(tokenAccount, owner.keys).available;

// 3. The proofs of "available at least X": the withdraw plan's two context accounts (version 0,
// so they are verified in their own transactions), created and verified, not the withdraw itself.
const plan = await confidentialWithdrawPlan({
  owner: owner.signer.address,
  token: owner.wusdc as Address,
  tokenAccount,
  mint: bootstrap.wrappedUsdcMint,
  decimals: bootstrap.usdcDecimals,
  amount: THRESHOLD,
  keys: owner.keys,
  version: 0,
  rent: (space) => rpc.getMinimumBalanceForRentExemption(space).send(),
});
const cosign = cosigner(plan.signers);
for (const transaction of plan.transactions.filter((step) => step.role === "proof")) {
  await sendWithWallet({
    rpc,
    wallet: owner.wallet,
    version: 0,
    instructions: transaction.instructions.map(fromPortableInstruction),
    cosign,
  });
}
// The closing instructions name each context account first; the proof type byte tells them apart.
const contexts: Record<number, { address: Address; bytes: number }> = {};
for (const closing of plan.cleanup) {
  const target = closing.accounts[0]?.address;
  if (!target) continue;
  const account = await fetchEncodedAccount(rpc, address(target), { commitment: "confirmed" });
  if (!account.exists || account.programAddress !== "ZkE1Gama1Proof11111111111111111111111111111")
    continue;
  contexts[new Uint8Array(account.data)[32] ?? -1] = {
    address: address(target),
    bytes: account.data.length,
  };
}
const equality = contexts[3];
const range = contexts[6];
if (!equality || !range) throw new Error("the equality or the range context account is missing");

// 4. The probe, simulated for its compute units, then sent.
const probeInstruction = (threshold: bigint): Instruction => {
  const data = new Uint8Array(8);
  new DataView(data.buffer).setBigUint64(0, threshold, true);
  return {
    programAddress: probe,
    accounts: [
      { address: owner.wusdc as Address, role: AccountRole.READONLY },
      { address: equality.address, role: AccountRole.READONLY },
      { address: range.address, role: AccountRole.READONLY },
    ],
    data,
  };
};
const passing = await simulateInstructions({
  rpc,
  feePayer: owner.signer.address,
  instructions: [probeInstruction(THRESHOLD)],
});
const failing = await simulateInstructions({
  rpc,
  feePayer: owner.signer.address,
  instructions: [probeInstruction(THRESHOLD + 1n)],
});
const sent = await sendWithWallet({
  rpc,
  wallet: owner.wallet,
  version: 0,
  instructions: [probeInstruction(THRESHOLD)],
});
const landed = await rpc
  .getTransaction(sent.signature as Parameters<typeof rpc.getTransaction>[0], {
    commitment: "confirmed",
    encoding: "json",
    maxSupportedTransactionVersion: 0,
  })
  .send();
const probeUnits = (logs: readonly string[]) =>
  logs
    .map((line) => new RegExp(`Program ${probe} consumed (\\d+) of`).exec(line)?.[1])
    .find(Boolean);

// 5. The context accounts closed, their rent to the owner.
await closeProofAccounts({
  rpc,
  wallet: owner.wallet,
  version: 0,
  cleanup: plan.cleanup,
  cosign,
});

console.log(
  JSON.stringify(
    {
      probe,
      probeBytes: execFileSync("wc", ["-c", so], { encoding: "utf8" }).trim().split(/\s+/)[0],
      owner: owner.signer.address,
      available: available.toString(),
      threshold: THRESHOLD.toString(),
      equalityContext: equality,
      rangeContext: range,
      passing: {
        err: passing.err,
        probeUnits: probeUnits(passing.logs),
        transactionUnits: passing.unitsConsumed.toString(),
      },
      thresholdPlusOne: { err: passing.err === null ? failing.err : "n/a" },
      sent: {
        signature: sent.signature,
        err: landed?.meta?.err ?? null,
        computeUnitsConsumed: landed?.meta?.computeUnitsConsumed?.toString(),
        probeUnits: probeUnits(landed?.meta?.logMessages ?? []),
      },
    },
    (_, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
    2,
  ),
);
