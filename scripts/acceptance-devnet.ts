// pnpm acceptance:devnet (step 3.11, 14 section 5): the hackathon acceptance scenario on devnet, end
// to end and unattended, against the devnet app and worker running on this machine.
//
// 1. Checks the running services: apps/web on http://localhost:3000 configured for devnet and
//    healthy, the worker writing its log.
// 2. Creates fresh keypairs for an owner, three recipients, an accountant and the run's admin under
//    ~/.config/solana/sotto/devnet-acceptance/<UTC time>/ (folder 700, files 600, never in the repo).
// 3. Funds them from wallet A with the measured amounts plus a margin: SOL for the owner and the
//    recipients and 1 devnet USDC for the owner; the accountant and the admin only sign messages.
//    Every transfer is simulated first, then sent and finalized; the signatures go to funding.json.
// 4. Makes the run's admin a Sotto admin through the configured path (ADMIN_WALLETS in
//    packages/db/.env.local and pnpm --filter @sotto/db seed:admins), for this run only.
// 5. Runs tests/e2e/localnet/acceptance.spec.ts with SOTTO_ACCEPTANCE_TARGET=devnet
//    (tests/e2e/acceptance-target.ts): its checks of step 2.10 stay on (I-2 over requests, browser
//    consoles, the services' logs and the app's database; no console error; no health banner; every
//    balance equal to the chain). The eight step screenshots go to .demo-shots/devnet-acceptance/.
// 6. Always puts packages/db/.env.local back as it was and removes the admin row.
// 7. Verifies the result on devnet itself: every transaction of the run's wallets finalized without
//    an error, the SAS attestation, the proof record, and /v/ fetched without a session; writes
//    verification.json next to the screenshots.
//
// The founder's Solflare accounts are never used. Each run needs 1 devnet USDC in wallet A (Circle's
// devnet faucet refills it) and about 0.14 SOL.
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { decodeBusinessAttestation } from "@sotto/sdk/attestation";
import { getClusterConfig, type AvailableClusterConfig } from "@sotto/sdk/cluster";
import { fetchProofRecord } from "@sotto/sdk/proofs";
import { sendWithKeypairSigners, simulateInstructions, type SolanaRpc } from "@sotto/sdk/tx";
import {
  address,
  createKeyPairSignerFromBytes,
  fetchEncodedAccount,
  lamports,
  signature as toSignature,
  type Address,
  type Instruction,
} from "@solana/kit";
import { devnetRpc, sottoKeypair } from "./devnet.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const APP = "http://localhost:3000";
const SOL = 1_000_000_000n;
const USDC = 1_000_000n;
const FUNDING: Record<string, { sol: bigint; usdc: bigint }> = {
  owner: { sol: (8n * SOL) / 100n, usdc: USDC },
  "person-1": { sol: (2n * SOL) / 100n, usdc: 0n },
  "person-2": { sol: (2n * SOL) / 100n, usdc: 0n },
  "person-3": { sol: (2n * SOL) / 100n, usdc: 0n },
};
const ROLES = ["owner", "person-1", "person-2", "person-3", "accountant", "admin"] as const;
const DB_ENV = join(ROOT, "packages/db/.env.local");

function fail(message: string): never {
  console.error(`acceptance:devnet: ${message}`);
  process.exit(1);
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): number {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: "inherit", env });
  return result.status ?? 1;
}

// 1. The running services.
const web = parseEnv(readFileSync(join(ROOT, "apps/web/.env.local"), "utf8"));
if (web.NEXT_PUBLIC_CLUSTER !== "devnet") fail("apps/web/.env.local is not configured for devnet");
const health = await fetch(`${APP}/api/health`).then(
  (response) => response.json() as Promise<{ status?: string; database?: string }>,
  () => null,
);
if (health?.status !== "ok" || health.database !== "ok") {
  fail(`the app at ${APP} is not healthy; start apps/web and apps/worker on devnet first (14)`);
}
const workerLog = join(ROOT, ".localnet/devnet-run/worker.log");
const workerAge = Date.now() - (statSync(workerLog, { throwIfNoEntry: false })?.mtimeMs ?? 0);
if (workerAge > 120_000)
  fail("the worker has not written its log for 2 minutes; start apps/worker");
const cluster = getClusterConfig("devnet") as AvailableClusterConfig;
if (!cluster.usdcMint || !cluster.sasCredential || !cluster.sottoProofs) {
  fail("the devnet cluster config has no USDC mint, SAS credential or sotto_proofs");
}
const usdcMint = cluster.usdcMint;
const rpc: SolanaRpc = await devnetRpc();
const walletA = await sottoKeypair("wallet-a.json");

// 2. Fresh keypairs, outside the repository.
const stamp = new Date()
  .toISOString()
  .replace(/\.\d+Z$/, "Z")
  .replaceAll(":", "-");
const dir = join(homedir(), ".config/solana/sotto/devnet-acceptance", stamp);
mkdirSync(dir, { recursive: true, mode: 0o700 });
const wallets: Record<string, Address> = {};
for (const role of ROLES) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const bytes = [
    ...privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32),
    ...publicKey.export({ format: "der", type: "spki" }).subarray(-32),
  ];
  writeFileSync(join(dir, `${role}.json`), JSON.stringify(bytes), { mode: 0o600, flag: "wx" });
  wallets[role] = (await createKeyPairSignerFromBytes(new Uint8Array(bytes))).address;
}
const legalName = `Acceptance Devnet ${stamp.slice(0, 16).replace("T", " ")} Ltd`;
writeFileSync(
  join(dir, "run.json"),
  `${JSON.stringify({ stamp, legalName, wallets }, null, 2)}\n`,
  {
    mode: 0o600,
  },
);
console.log(`run ${stamp}: keypairs in ${dir}`);
for (const role of ROLES) console.log(`  ${role.padEnd(10)} ${wallets[role]}`);

// 3. Funding from wallet A, each transfer simulated first.
const usdcAccount = async (owner: Address) =>
  (await findAssociatedTokenPda({ owner, mint: usdcMint, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
const balanceA = (await rpc.getBalance(walletA.address, { commitment: "confirmed" }).send()).value;
const usdcA = BigInt(
  (
    await rpc
      .getTokenAccountBalance(await usdcAccount(walletA.address), { commitment: "confirmed" })
      .send()
  ).value.amount,
);
if (usdcA < USDC) fail("wallet A holds less than 1 devnet USDC; refill it from Circle's faucet");
if (balanceA < SOL / 5n) fail("wallet A holds less than 0.2 SOL");
const funding: { role: string; what: string; signature: string }[] = [];
for (const [role, amount] of Object.entries(FUNDING)) {
  const wallet = wallets[role] as Address;
  const transfers: { what: string; instructions: Instruction[] }[] = [
    {
      what: `${Number(amount.sol) / Number(SOL)} SOL`,
      instructions: [
        getTransferSolInstruction({
          source: walletA,
          destination: wallet,
          amount: lamports(amount.sol),
        }),
      ],
    },
  ];
  if (amount.usdc > 0n) {
    transfers.push({
      what: `${Number(amount.usdc) / Number(USDC)} USDC`,
      instructions: [
        getCreateAssociatedTokenIdempotentInstruction({
          payer: walletA,
          ata: await usdcAccount(wallet),
          owner: wallet,
          mint: usdcMint,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        }),
        getTransferCheckedInstruction({
          source: await usdcAccount(walletA.address),
          mint: usdcMint,
          destination: await usdcAccount(wallet),
          authority: walletA,
          amount: amount.usdc,
          decimals: 6,
        }),
      ],
    });
  }
  for (const transfer of transfers) {
    const simulated = await simulateInstructions({
      rpc,
      feePayer: walletA.address,
      instructions: transfer.instructions,
    });
    if (simulated.err) fail(`${role} ${transfer.what}: simulation failed`);
    const sent = await sendWithKeypairSigners({
      rpc,
      feePayer: walletA,
      instructions: transfer.instructions,
      finalize: true,
    });
    funding.push({ role, what: transfer.what, signature: sent.signature });
    console.log(
      `funded ${role} ${transfer.what} (simulated ${simulated.unitsConsumed} units): ${sent.signature}`,
    );
  }
}
writeFileSync(join(dir, "funding.json"), `${JSON.stringify(funding, null, 2)}\n`, { mode: 0o600 });

// 4 to 6. The run's admin for this run only, the scenario, and always the way back.
const dbEnv = readFileSync(DB_ENV, "utf8");
const adminLine = /^ADMIN_WALLETS=(.*)$/m;
const current = adminLine.exec(dbEnv)?.[1]?.trim() ?? "";
const withAdmin = adminLine.test(dbEnv)
  ? dbEnv.replace(adminLine, `ADMIN_WALLETS=${[current, wallets.admin].filter(Boolean).join(",")}`)
  : `${dbEnv.replace(/\n?$/, "\n")}ADMIN_WALLETS=${wallets.admin}\n`;
let restored = false;
const restore = () => {
  if (restored) return;
  restored = true;
  writeFileSync(DB_ENV, dbEnv);
  const removed = run("pnpm", ["--filter", "@sotto/db", "remove:admins", wallets.admin as string]);
  console.log(
    `admin of the run removed: ${removed === 0 ? "yes" : "no"}; packages/db/.env.local restored: yes`,
  );
};
process.on("SIGINT", () => {
  restore();
  process.exit(130);
});
let passed: boolean;
try {
  writeFileSync(DB_ENV, withAdmin);
  // A throw, not fail(): the finally below must put the env file back.
  if (run("pnpm", ["--filter", "@sotto/db", "seed:admins"]) !== 0)
    throw new Error("seed:admins failed");
  passed =
    run(
      "pnpm",
      [
        "--filter",
        "@sotto/e2e",
        "exec",
        "playwright",
        "test",
        "--config",
        "playwright.devnet.config.ts",
      ],
      { ...process.env, SOTTO_ACCEPTANCE_TARGET: "devnet", SOTTO_DEVNET_ACCEPTANCE_DIR: dir },
    ) === 0;
} finally {
  restore();
}
if (!passed) fail(`the scenario failed; the run's files are in ${dir}`);

// 7. The result, verified on devnet here.
const result = JSON.parse(readFileSync(join(dir, "result.json"), "utf8")) as {
  legalName: string;
  orgId: string;
  attestation: string;
  proofRecord: string;
  statement: string;
  owner: string;
  screenshots: string;
};
const problems: string[] = [];

async function finalized(signature: string) {
  for (let attempt = 0; attempt < 45; attempt++) {
    const transaction = await rpc
      .getTransaction(toSignature(signature), {
        commitment: "finalized",
        // Version 1 transactions are read only with 1 here (facts D2), as the worker reads them.
        maxSupportedTransactionVersion: 1,
        encoding: "base64",
      })
      .send();
    if (transaction) return transaction;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  return null;
}

const transactions = new Map<string, { slot: string; version: string; fee: string }>();
for (const role of ROLES) {
  const listed = await rpc
    .getSignaturesForAddress(wallets[role] as Address, { limit: 1000, commitment: "confirmed" })
    .send();
  for (const entry of listed) {
    if (transactions.has(entry.signature)) continue;
    const transaction = await finalized(entry.signature);
    if (!transaction) {
      problems.push(`${entry.signature} not finalized`);
      continue;
    }
    if (transaction.meta?.err) problems.push(`${entry.signature} failed onchain`);
    transactions.set(entry.signature, {
      slot: transaction.slot.toString(),
      version: String(transaction.version),
      fee: String(transaction.meta?.fee ?? ""),
    });
  }
}
for (const entry of funding) {
  if (!transactions.has(entry.signature)) problems.push(`funding ${entry.signature} not listed`);
}

const attestationAccount = await fetchEncodedAccount(rpc, address(result.attestation), {
  commitment: "finalized",
});
let attestation: Record<string, string> = {};
if (!attestationAccount.exists) {
  problems.push("the attestation does not exist");
} else {
  const decoded = decodeBusinessAttestation(new Uint8Array(attestationAccount.data));
  attestation = {
    legalName: decoded.data.legalName,
    country: decoded.data.country,
    orgId: decoded.data.orgId,
    credential: decoded.credential,
  };
  if (decoded.data.legalName !== result.legalName) problems.push("attestation: legal name");
  if (decoded.data.orgId !== result.orgId) problems.push("attestation: organization");
  if (decoded.credential !== cluster.sasCredential) problems.push("attestation: credential");
}

const record = await fetchProofRecord(rpc, address(result.proofRecord), {
  commitment: "finalized",
});
const recordAccount = await fetchEncodedAccount(rpc, address(result.proofRecord), {
  commitment: "finalized",
});
if (!recordAccount.exists || recordAccount.programAddress !== cluster.sottoProofs.program) {
  problems.push("the proof record is not an account of sotto_proofs");
}
if (record.data.owner !== result.owner) problems.push("proof record: owner");
if (record.data.threshold !== 500_000n) problems.push("proof record: threshold");
if (record.data.expiry <= BigInt(Math.floor(Date.now() / 1000))) problems.push("record expired");

// /v/ without a session: no cookie is sent.
const page = await (await fetch(`${APP}/v/${result.proofRecord}`)).text();
const shows = (testId: string, text: string) =>
  new RegExp(`data-testid="${testId}"[^>]*>${text.replace(/[$.]/g, "\\$&")}<`).test(page);
const publicPage = {
  proven: shows("verify-word", "Proven"),
  organization: shows("verify-organization", `${result.legalName}, NL`),
  statement: shows("verify-statement", result.statement),
  disclosed: shows("verify-disclosed", "none"),
};
for (const [check, ok] of Object.entries(publicPage)) {
  if (!ok) problems.push(`/v/: ${check}`);
}

const verification = {
  run: stamp,
  wallets,
  funding,
  transactions: Object.fromEntries(transactions),
  attestation: { address: result.attestation, ...attestation },
  proofRecord: {
    address: result.proofRecord,
    owner: record.data.owner,
    threshold: record.data.threshold.toString(),
    slot: record.data.slot.toString(),
    expiry: record.data.expiry.toString(),
  },
  publicPage,
  problems,
};
const text = `${JSON.stringify(verification, null, 2)}\n`;
writeFileSync(join(dir, "verification.json"), text, { mode: 0o600 });
writeFileSync(join(result.screenshots, "verification.json"), text);
console.log(
  `verified on devnet: ${transactions.size} transactions finalized without an error, attestation ${result.attestation}, proof record ${result.proofRecord}, /v/ ${Object.values(publicPage).every(Boolean) ? "Proven" : "not as expected"}`,
);
if (problems.length > 0) fail(`verification problems: ${problems.join("; ")}`);
console.log(`acceptance:devnet passed; screenshots and verification.json in ${result.screenshots}`);
