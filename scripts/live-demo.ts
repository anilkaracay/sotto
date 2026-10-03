// The live runs of step 4.3's plan against the hosted devnet app (D-29; founder, 2026-10-03), from the
// founder's Mac. Wallet A pays and never leaves the Mac; the hosting server is reached only as the
// sotto user through `sotto-compose`, through the redacting loader (scripts/hosting-env.ts). Every
// transfer is simulated first, sent, finalized and written to the run's folder with its signature.
//
//   node scripts/live-demo.ts fund-authority    0.3 SOL from wallet A to the devUSD mint authority
//   node scripts/live-demo.ts faucet-check      a fresh demo wallet tries the faucet card in a browser
//   node scripts/live-demo.ts seed              Northwind Labs Demo Ltd, through the app's own paths
//
// faucet-check and seed create their keypairs outside the repository (mode 600, folders 700), add
// the run's own admin with `sotto-compose admins seed` and always remove it again, confirming the
// removal by removing it a second time (0 of 1). The seed's keypairs stay in
// ~/.config/solana/sotto/demo/ for the video (DEMO-RUNBOOK.md); a second seed is refused.
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTransferSolInstruction } from "@solana-program/system";
import { getClusterConfig } from "@sotto/sdk/cluster";
import { sendWithKeypairSigners, simulateInstructions } from "@sotto/sdk/tx";
import {
  address,
  createKeyPairSignerFromBytes,
  fetchEncodedAccount,
  lamports,
  signature as toSignature,
  type Address,
} from "@solana/kit";
import { devnetRpc, sottoKeypair } from "./devnet.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const APP = "https://sottoapp.xyz";
const SOL = 1_000_000_000n;
const HOME = join(homedir(), ".config/solana/sotto");
/** The seed's people: Elif, the twelve, the two counterparties, Daniel (tests/e2e/seed/northwind.ts). */
const PAID = [
  "maya",
  "idris",
  "lucia",
  "aiko",
  "tomas",
  "kwame",
  "priya",
  "noah",
  "sofia",
  "jonas",
  "amara",
  "selin",
  "atlas",
  "halden",
];
const TREASURY = 1_500_000;

function fail(message: string): never {
  console.error(`live-demo: ${message}`);
  process.exit(1);
}

const devnet = getClusterConfig("devnet");
const devusd = devnet.available ? devnet.assets.find((asset) => asset.id === "devusd") : null;
if (!devusd?.sottoProofs) fail("the devnet registry has no devUSD with its sotto_proofs");
const rpc = await devnetRpc();
const walletA = await sottoKeypair("wallet-a.json");
const balance = async (wallet: Address) =>
  (await rpc.getBalance(wallet, { commitment: "confirmed" }).send()).value;

/**
 * One `sotto-compose` command on the server as the sotto user; its output, never a secret. The
 * connection is kept alive and given up after a minute without an answer: in the live seed of
 * 2026-10-03 a silent connection kept the admin's removal waiting for 26 minutes after the server had
 * done it.
 */
function sottoCompose(args: string): { ok: boolean; out: string } {
  if (!/^[A-Za-z0-9 -]+$/.test(args)) fail("unexpected sotto-compose arguments");
  const result = spawnSync(
    "node",
    [
      "scripts/hosting-env.ts",
      "--",
      "bash",
      "-c",
      `ssh "$OPERATOR_HOST" sotto-compose ${args}`,
    ],
    { cwd: ROOT, encoding: "utf8", timeout: 300_000 },
  );
  return { ok: result.status === 0, out: `${result.stdout}${result.stderr}`.trim() };
}

type Sent = { what: string; signature: string };

async function sendSol(to: Address, amount: bigint, what: string): Promise<Sent> {
  const instructions = [
    getTransferSolInstruction({ source: walletA, destination: to, amount: lamports(amount) }),
  ];
  const simulated = await simulateInstructions({ rpc, feePayer: walletA.address, instructions });
  if (simulated.err) fail(`${what}: simulation failed`);
  const sent = await sendWithKeypairSigners({
    rpc,
    feePayer: walletA,
    instructions,
    finalize: true,
  });
  console.log(`${what}: ${sent.signature}`);
  return { what, signature: sent.signature };
}

async function newKeypairs(
  dir: string,
  names: readonly string[],
): Promise<Record<string, Address>> {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const wallets: Record<string, Address> = {};
  for (const name of names) {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const bytes = [
      ...privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32),
      ...publicKey.export({ format: "der", type: "spki" }).subarray(-32),
    ];
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(bytes), { mode: 0o600, flag: "wx" });
    wallets[name] = (await createKeyPairSignerFromBytes(new Uint8Array(bytes))).address;
  }
  return wallets;
}

/** Adds the run's admin, runs the body, then removes the admin, whatever happened, and confirms it. */
async function withAdmin(admin: Address, body: () => Promise<boolean>): Promise<boolean> {
  const seeded = sottoCompose(`admins seed ${admin}`);
  if (!seeded.ok || !/admins seeded: 1 added/.test(seeded.out)) {
    fail(`the run's admin was not added: ${seeded.out.split("\n").pop()}`);
  }
  console.log(`admin of the run added: ${admin}`);
  let passed: boolean;
  try {
    passed = await body();
  } catch (error) {
    console.error(error);
    passed = false;
  }
  const removed = sottoCompose(`admins remove ${admin}`);
  const again = sottoCompose(`admins remove ${admin}`);
  const gone =
    /admins removed: 1 of 1/.test(removed.out) && /admins removed: 0 of 1/.test(again.out);
  console.log(
    `admin of the run removed: ${gone ? "yes, and confirmed (a second removal found none)" : "NOT CONFIRMED"}`,
  );
  return passed && gone;
}

function playwright(config: string, env: Record<string, string>): boolean {
  const result = spawnSync(
    "pnpm",
    ["--filter", "@sotto/e2e", "exec", "playwright", "test", "--config", config],
    { cwd: ROOT, stdio: "inherit", env: { ...process.env, ...env } },
  );
  return result.status === 0;
}

/** Every transaction of the wallets, finalized and without an error; their count. */
async function verifyTransactions(
  wallets: readonly Address[],
): Promise<{ count: number; problems: string[] }> {
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const wallet of wallets) {
    const listed = await rpc
      .getSignaturesForAddress(wallet, { limit: 1000, commitment: "confirmed" })
      .send();
    for (const entry of listed) {
      if (seen.has(entry.signature)) continue;
      seen.add(entry.signature);
      if (entry.err) problems.push(`${entry.signature} failed onchain`);
    }
  }
  return { count: seen.size, problems };
}

const stamp = new Date()
  .toISOString()
  .replace(/\.\d+Z$/, "Z")
  .replaceAll(":", "-");
const command = process.argv[2];
const health = await fetch(`${APP}/api/health`).then(
  (response) => response.json() as Promise<{ status?: string; database?: string }>,
  () => null,
);
if (health?.status !== "ok" || health.database !== "ok") fail(`${APP} is not healthy`);
const before = await balance(walletA.address);
console.log(`wallet A before: ${before} lamports`);

if (command === "fund-authority") {
  const authority = address(process.argv[3] ?? "");
  const mint = await fetchEncodedAccount(rpc, devusd.baseMint, { commitment: "finalized" });
  if (!mint.exists) fail("the devUSD mint does not exist");
  await sendSol(authority, (3n * SOL) / 10n, `0.3 SOL to the devUSD mint authority ${authority}`);
  console.log(`mint authority: ${await balance(authority)} lamports`);
} else if (command === "faucet-check") {
  const dir = join(HOME, "demo-faucet", stamp);
  const wallets = await newKeypairs(dir, ["owner", "admin"]);
  const legalName = `Faucet Check ${stamp.slice(0, 16).replace("T", " ")} Demo Ltd`;
  writeFileSync(
    join(dir, "run.json"),
    `${JSON.stringify({ stamp, legalName, wallets }, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
  console.log(`faucet check ${stamp}: owner ${wallets.owner}, admin ${wallets.admin}`);
  const funding = [
    await sendSol(wallets.owner as Address, (2n * SOL) / 100n, "0.02 SOL to the owner"),
  ];
  writeFileSync(join(dir, "funding.json"), `${JSON.stringify(funding, null, 2)}\n`, {
    mode: 0o600,
  });
  const shots = join(ROOT, ".demo-shots/live", `${stamp}-faucet`);
  const passed = await withAdmin(wallets.admin as Address, async () =>
    playwright("playwright.live.config.ts", {
      SOTTO_LIVE_URL: APP,
      SOTTO_LIVE_DIR: dir,
      SOTTO_SHOTS_DIR: shots,
    }),
  );
  if (!passed) fail(`the faucet check failed; its files are in ${dir}`);
  const result = JSON.parse(readFileSync(join(dir, "result.json"), "utf8")) as {
    mintSignature: string;
  };
  const minted = await rpc
    .getTransaction(toSignature(result.mintSignature), {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
      encoding: "base64",
    })
    .send();
  if (!minted || minted.meta?.err) fail("the faucet's mint is not finalized without an error");
  console.log(`faucet check passed: ${readFileSync(join(dir, "result.json"), "utf8")}`);
  console.log(`screenshots: ${shots}; files: ${dir}`);
} else if (command === "seed") {
  const dir = join(HOME, "demo");
  if (existsSync(join(dir, "elif.json"))) fail(`${dir} holds a seed's keypairs already; refused`);
  const wallets = await newKeypairs(dir, ["elif", ...PAID, "daniel", "admin"]);
  writeFileSync(join(dir, "run.json"), `${JSON.stringify({ stamp, wallets }, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(`seed ${stamp}: keypairs in ${dir}`);
  for (const [name, wallet] of Object.entries(wallets))
    console.log(`  ${name.padEnd(8)} ${wallet}`);
  const funding: Sent[] = [
    await sendSol(wallets.elif as Address, (5n * SOL) / 100n, "0.05 SOL to Elif"),
  ];
  for (const name of PAID) {
    funding.push(
      await sendSol(wallets[name] as Address, (6n * SOL) / 1000n, `0.006 SOL to ${name}`),
    );
  }
  const minted = sottoCompose(`devusd-mint ${wallets.elif} ${TREASURY}`);
  const mintSignature = new RegExp(`minted ${TREASURY} devUSD to \\S+: (\\S+)`).exec(
    minted.out,
  )?.[1];
  if (!minted.ok || !mintSignature) fail("the operator's treasury mint failed");
  funding.push({ what: `${TREASURY} devUSD to Elif (operator mint)`, signature: mintSignature });
  console.log(`${TREASURY} devUSD to Elif (operator mint on the server): ${mintSignature}`);
  writeFileSync(join(dir, "funding.json"), `${JSON.stringify(funding, null, 2)}\n`, {
    mode: 0o600,
  });
  const shots = join(ROOT, ".demo-shots/live", `${stamp}-seed`);
  const passed = await withAdmin(wallets.admin as Address, async () =>
    playwright("playwright.seed.config.ts", {
      SOTTO_SEED_TARGET: "devnet",
      SOTTO_SEED_URL: APP,
      SOTTO_SEED_DIR: dir,
      SOTTO_SHOTS_DIR: shots,
    }),
  );
  if (!passed) fail(`the seed failed; its files are in ${dir}`);
  const result = JSON.parse(readFileSync(join(dir, "seed-result.json"), "utf8")) as {
    orgId: string;
    proofRecord: string;
    danielBooksCount: number;
  };
  const record = await fetchEncodedAccount(rpc, address(result.proofRecord), {
    commitment: "finalized",
  });
  const problems: string[] = [];
  if (!record.exists || record.programAddress !== devusd.sottoProofs.program) {
    problems.push("the proof record is not an account of devUSD's sotto_proofs");
  }
  const page = await (await fetch(`${APP}/v/${result.proofRecord}`)).text();
  const shows = (testId: string, text: string) =>
    new RegExp(`data-testid="${testId}"[^>]*>${text.replace(/[$.]/g, "\\$&")}<`).test(page);
  if (!shows("verify-word", "Proven")) problems.push("/v/: not Proven");
  if (!shows("verify-statement", "Balance is at least 250,000 devUSD")) {
    problems.push("/v/: the statement");
  }
  const transactions = await verifyTransactions(
    Object.entries(wallets)
      .filter(([name]) => name !== "admin" && name !== "daniel")
      .map(([, wallet]) => wallet),
  );
  problems.push(...transactions.problems);
  const verification = {
    stamp,
    organization: result.orgId,
    publicProof: `${APP}/v/${result.proofRecord}`,
    danielBooksCount: result.danielBooksCount,
    transactions: transactions.count,
    funding,
    problems,
    screenshots: shots,
  };
  writeFileSync(join(dir, "verification.json"), `${JSON.stringify(verification, null, 2)}\n`, {
    mode: 0o600,
  });
  console.log(JSON.stringify(verification, null, 2));
  if (problems.length > 0) fail(`verification problems: ${problems.join("; ")}`);
} else {
  fail("usage: live-demo.ts fund-authority <mint authority> | faucet-check | seed");
}
const after = await balance(walletA.address);
console.log(`wallet A after: ${after} lamports (${before - after} less)`);
