// Sends transactions signed by server side keypairs (worker, scripts), following 06 section 9:
// fresh blockhash, 75th percentile priority fee, simulation, compute unit limit at simulated usage
// plus 20 percent, then send and wait for confirmation. Wallet signed transactions (with the signed
// message check) are built in the browser path.
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  isWritableRole,
  pipe,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageComputeUnitPrice,
  setTransactionMessageFeePayer,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type Signature,
} from "@solana/kit";
import {
  computeUnitLimitFromSimulation,
  DEFAULT_PRIORITY_FEE_CAP_MICRO_LAMPORTS,
  MAX_COMPUTE_UNIT_LIMIT,
  priorityFeeFromRecentFees,
} from "./compute-budget.ts";
import type { SolanaRpc } from "./rpc.ts";

export class SimulationFailedError extends Error {
  readonly logs: readonly string[];
  constructor(err: unknown, logs: readonly string[] | null | undefined) {
    super(
      `simulation failed: ${JSON.stringify(err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
    );
    this.name = "SimulationFailedError";
    this.logs = logs ?? [];
  }
}

export type SimulationResult = {
  err: unknown;
  logs: readonly string[];
  unitsConsumed: bigint;
};

async function simulateWire(
  rpc: SolanaRpc,
  wire: ReturnType<typeof getBase64EncodedWireTransaction>,
): Promise<SimulationResult> {
  const { value } = await rpc
    .simulateTransaction(wire, {
      encoding: "base64",
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    })
    .send();
  return {
    err: value.err ?? null,
    logs: value.logs ?? [],
    unitsConsumed: value.unitsConsumed ?? 0n,
  };
}

/** Simulates instructions without signatures, with the maximum compute unit limit. Never sends. */
export async function simulateInstructions(options: {
  rpc: SolanaRpc;
  feePayer: Address;
  instructions: readonly Instruction[];
}): Promise<SimulationResult> {
  const { value: blockhash } = await options.rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(options.feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(options.instructions, m),
    (m) => setTransactionMessageComputeUnitLimit(MAX_COMPUTE_UNIT_LIMIT, m),
  );
  return simulateWire(options.rpc, getBase64EncodedWireTransaction(compileTransaction(message)));
}

export type SendResult = {
  signature: Signature;
  computeUnitLimit: number;
  computeUnitPrice: bigint;
  unitsConsumed: bigint;
};

export function writableAccounts(instructions: readonly Instruction[]): Address[] {
  const seen = new Set<Address>();
  for (const instruction of instructions) {
    for (const meta of instruction.accounts ?? []) {
      if (isWritableRole(meta.role)) seen.add(meta.address);
    }
  }
  return [...seen];
}

export async function waitForConfirmation(
  rpc: SolanaRpc,
  signature: Signature,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value } = await rpc.getSignatureStatuses([signature]).send();
    const status = value[0];
    if (status?.err) {
      throw new Error(
        `transaction ${signature} failed: ${JSON.stringify(status.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
      );
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized")
      return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`transaction ${signature} was not confirmed within ${timeoutMs / 1000} seconds`);
}

export async function sendWithKeypairSigners(options: {
  rpc: SolanaRpc;
  feePayer: KeyPairSigner;
  instructions: readonly Instruction[];
  priorityFeeCapMicroLamports?: bigint;
  confirmTimeoutMs?: number;
}): Promise<SendResult> {
  const { rpc, feePayer, instructions } = options;
  const recentFees = await rpc.getRecentPrioritizationFees(writableAccounts(instructions)).send();
  const computeUnitPrice = priorityFeeFromRecentFees(
    recentFees,
    options.priorityFeeCapMicroLamports ?? DEFAULT_PRIORITY_FEE_CAP_MICRO_LAMPORTS,
  );
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const base = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
    (m) => setTransactionMessageComputeUnitPrice(computeUnitPrice, m),
  );
  const simulation = await simulateWire(
    rpc,
    getBase64EncodedWireTransaction(
      compileTransaction(setTransactionMessageComputeUnitLimit(MAX_COMPUTE_UNIT_LIMIT, base)),
    ),
  );
  if (simulation.err) throw new SimulationFailedError(simulation.err, simulation.logs);
  const unitsConsumed = simulation.unitsConsumed;
  if (unitsConsumed === 0n)
    throw new Error("the RPC did not report compute units for the simulation");
  const computeUnitLimit = computeUnitLimitFromSimulation(unitsConsumed);
  const signed = await signTransactionMessageWithSigners(
    setTransactionMessageComputeUnitLimit(computeUnitLimit, base),
  );
  const signature = getSignatureFromTransaction(signed);
  await rpc
    .sendTransaction(getBase64EncodedWireTransaction(signed), {
      encoding: "base64",
      preflightCommitment: "confirmed",
    })
    .send();
  await waitForConfirmation(rpc, signature, options.confirmTimeoutMs);
  return { signature, computeUnitLimit, computeUnitPrice, unitsConsumed };
}
