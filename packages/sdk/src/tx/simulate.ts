// Simulation (06 section 9: simulate every transaction before asking for a signature; show the decoded
// failure). Simulations run without signature checks and with the latest blockhash.
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
} from "@solana/kit";
import { applyComputeBudget, SIMULATION_BUDGET } from "./budget.ts";
import { decodeTransactionError, type DecodedTransactionError } from "./errors.ts";
import type { SolanaRpc } from "./rpc.ts";

const json = (value: unknown) =>
  JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));

export class SimulationFailedError extends Error {
  readonly err: unknown;
  readonly decoded: DecodedTransactionError;
  readonly logs: readonly string[];
  constructor(
    err: unknown,
    logs: readonly string[] | null | undefined,
    programs: readonly Address[] = [],
  ) {
    const decoded = decodeTransactionError(err, programs);
    super(`simulation failed: ${decoded.message} (${json(err)})`);
    this.name = "SimulationFailedError";
    this.err = err;
    this.decoded = decoded;
    this.logs = logs ?? [];
  }
}

export type SimulationResult = {
  err: unknown;
  logs: readonly string[];
  unitsConsumed: bigint;
  /** Reported by the RPC for the simulated transaction, when it does. */
  loadedAccountsDataSize: number | null;
};

export async function simulateWire(
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
    loadedAccountsDataSize:
      value.loadedAccountsDataSize === undefined ? null : Number(value.loadedAccountsDataSize),
  };
}

/** Simulates instructions without signatures, with the maximum limits. Never sends. */
export async function simulateInstructions(options: {
  rpc: SolanaRpc;
  feePayer: Address;
  instructions: readonly Instruction[];
  version?: 0 | 1;
}): Promise<SimulationResult> {
  const { value: blockhash } = await options.rpc
    .getLatestBlockhash({ commitment: "confirmed" })
    .send();
  const message = pipe(
    createTransactionMessage({ version: options.version ?? 0 }),
    (m) => setTransactionMessageFeePayer(options.feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(options.instructions, m),
  );
  return simulateWire(
    options.rpc,
    getBase64EncodedWireTransaction(
      compileTransaction(applyComputeBudget(message, SIMULATION_BUDGET)),
    ),
  );
}
