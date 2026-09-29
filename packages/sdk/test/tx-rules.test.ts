// The transaction rules of 06 section 9 (step 1.6): budgets per version, decoded errors, the signed
// message check (all three cases, v0 and v1), preparation and confirmation.
import { getTransferSolInstruction } from "@solana-program/system";
import {
  address,
  appendTransactionMessageInstruction,
  blockhash,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionMessageComputeUnitLimit,
  getTransactionMessageComputeUnitPrice,
  getTransactionMessageLoadedAccountsDataSizeLimit,
  getTransactionMessagePriorityFeeLamports,
  decompileTransactionMessage,
  lamports,
  pipe,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageComputeUnitPrice,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Signature,
  type TransactionMessage,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  applyComputeBudget,
  compareSignedMessage,
  decodeTransactionError,
  loadedAccountsDataSizeLimitFromSimulation,
  MAX_COMPUTE_UNIT_LIMIT,
  MAX_LOADED_ACCOUNTS_DATA_SIZE,
  prepareTransaction,
  priorityFeeLamports,
  SimulationFailedError,
  TransactionFailedError,
  waitForConfirmation,
  WALLET_CHANGED_TRANSACTION,
  type SolanaRpc,
} from "../src/tx/index.ts";

const PAYER: Address = address("EQMW3o1DVsB72Ej1RRRmHLW1XaEpbjLKrMHUbS8cRLZC");
const OTHER: Address = address("7SSpLJh516AbWiV5GM7ooZFTHoQN64pdohYxbDs3Gq4L");
const DEST: Address = address("6xosZg2PbZuneXX4riov7GmUCJmydQc3o5MGX6p5EU2");
const BLOCKHASH = blockhash("EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG");
const TOKEN_2022: Address = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const SYSTEM: Address = address("11111111111111111111111111111111");

function transfer(amount: bigint, source = PAYER) {
  return getTransferSolInstruction({
    source: createNoopSigner(source),
    destination: DEST,
    amount: lamports(amount),
  });
}

function message(version: 0 | 1, amount = 1000n, feePayer: Address = PAYER): TransactionMessage {
  const built = pipe(
    createTransactionMessage({ version }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: BLOCKHASH, lastValidBlockHeight: 100n },
        m,
      ),
    (m) => appendTransactionMessageInstruction(transfer(amount, feePayer), m),
  );
  return built as unknown as TransactionMessage;
}

type V0 = Extract<TransactionMessage, { version: 0 }>;
type V1 = Extract<TransactionMessage, { version: 1 }>;

const bytes = (m: TransactionMessage) =>
  compileTransaction(m as Parameters<typeof compileTransaction>[0]).messageBytes;

describe("compute budget per version (06 section 9, facts D3)", () => {
  it("puts the budget into instructions for v0 and into the config for v1", () => {
    const v0 = applyComputeBudget(message(0), { computeUnitLimit: 1200, computeUnitPrice: 5000n });
    expect(getTransactionMessageComputeUnitLimit(v0)).toBe(1200);
    expect(getTransactionMessageComputeUnitPrice(v0 as V0)).toBe(5000n);
    expect(
      v0.instructions.filter((i) => i.programAddress.startsWith("ComputeBudget")),
    ).toHaveLength(2);

    const v1 = applyComputeBudget(message(1), {
      computeUnitLimit: 1200,
      computeUnitPrice: 5000n,
      loadedAccountsDataSizeLimit: 6000,
    });
    expect(getTransactionMessageComputeUnitLimit(v1)).toBe(1200);
    // 5000 micro-lamports per unit for 1200 units is 6 lamports in total.
    expect(getTransactionMessagePriorityFeeLamports(v1 as V1)).toBe(6n);
    expect(getTransactionMessageLoadedAccountsDataSizeLimit(v1)).toBe(6000);
    expect(v1.instructions.some((i) => i.programAddress.startsWith("ComputeBudget"))).toBe(false);
  });

  it("converts the price to the v1 total fee, rounding up, and bounds the loaded data limit", () => {
    expect(priorityFeeLamports(0n, 200_000)).toBe(0n);
    expect(priorityFeeLamports(1n, 1)).toBe(1n);
    expect(priorityFeeLamports(1_000n, 200_000)).toBe(200n);
    expect(priorityFeeLamports(1_000_000n, MAX_COMPUTE_UNIT_LIMIT)).toBe(1_400_000n);
    expect(loadedAccountsDataSizeLimitFromSimulation(undefined)).toBe(
      MAX_LOADED_ACCOUNTS_DATA_SIZE,
    );
    expect(loadedAccountsDataSizeLimitFromSimulation(1000)).toBe(1200);
    expect(loadedAccountsDataSizeLimitFromSimulation(60 * 1024 * 1024)).toBe(
      MAX_LOADED_ACCOUNTS_DATA_SIZE,
    );
    expect(() => loadedAccountsDataSizeLimitFromSimulation(-1)).toThrow();
  });
});

describe("decoded errors (09 section 4)", () => {
  it("names top level errors in plain words", () => {
    expect(decodeTransactionError("InsufficientFundsForFee")).toEqual({
      code: "insufficient_funds_for_fee",
      message: "The wallet does not have enough SOL to pay the network fee.",
    });
    expect(decodeTransactionError("BlockhashNotFound").code).toBe("blockhash_expired");
    expect(decodeTransactionError({ InsufficientFundsForRent: { account_index: 1 } }).code).toBe(
      "insufficient_funds_for_rent",
    );
    expect(decodeTransactionError("SomethingNew")).toEqual({
      code: "transaction_SomethingNew",
      message: "The transaction failed (SomethingNew).",
    });
    expect(decodeTransactionError(null).code).toBe("unknown");
  });

  it("names program errors with the program of the failed instruction", () => {
    const programs = [address("ComputeBudget111111111111111111111111111111"), TOKEN_2022, SYSTEM];
    expect(decodeTransactionError({ InstructionError: [1n, { Custom: 1n }] }, programs)).toEqual({
      code: "token_2022_1",
      message: "The token account does not have enough tokens for this step.",
      instructionIndex: 1,
      programAddress: TOKEN_2022,
    });
    expect(decodeTransactionError({ InstructionError: [1, { Custom: 3 }] }, programs).message).toBe(
      "Token program error: Account not associated with this Mint.",
    );
    // Step 2.3: the confidential transfer errors the client does not name, in plain words.
    expect(
      decodeTransactionError({ InstructionError: [1n, { Custom: 27n }] }, programs),
    ).toMatchObject({
      code: "token_2022_27",
      message:
        "The confidential balance changed after this transfer was prepared, so it no longer matches and nothing moved.",
    });
    expect(
      decodeTransactionError({ InstructionError: [1, { Custom: 25 }] }, programs).message,
    ).toBe("The receiving account does not accept confidential transfers right now.");
    expect(
      decodeTransactionError({ InstructionError: [1, { Custom: 60 }] }, programs).message,
    ).toBe("Token program error 60.");
    expect(decodeTransactionError({ InstructionError: [2, { Custom: 1 }] }, programs).message).toBe(
      "The account does not have enough SOL to perform the operation.",
    );
    expect(
      decodeTransactionError({ InstructionError: [0, "ProgramFailedToComplete"] }, programs).code,
    ).toBe("compute_budget_exceeded");
    expect(decodeTransactionError({ InstructionError: [5, { Custom: 7 }] }, programs)).toEqual({
      code: "custom_7",
      message: "A program refused the transaction with error 7.",
      instructionIndex: 5,
    });
  });
});

describe("signed message check (06 section 9, Q-08)", () => {
  for (const version of [0, 1] as const) {
    const budget = {
      computeUnitLimit: 1200,
      computeUnitPrice: 5000n,
      loadedAccountsDataSizeLimit: 6000,
    };
    const built = applyComputeBudget(message(version), budget);

    it(`v${version}: identical bytes proceed`, () => {
      expect(compareSignedMessage(bytes(built), bytes(built))).toEqual({ kind: "identical" });
    });

    it(`v${version}: a changed compute budget proceeds with the changes recorded`, () => {
      const walletBudget = {
        computeUnitLimit: 200_000,
        computeUnitPrice: 75_000n,
        loadedAccountsDataSizeLimit: 6000,
      };
      const result = compareSignedMessage(
        bytes(built),
        bytes(applyComputeBudget(message(version), walletBudget)),
      );
      expect(result.kind).toBe("compute_budget_only");
      const fields = result.kind === "compute_budget_only" ? result.changes : [];
      expect(fields).toContainEqual({ field: "computeUnitLimit", built: "1200", signed: "200000" });
      expect(fields).toContainEqual(
        version === 0
          ? { field: "computeUnitPrice", built: "5000", signed: "75000" }
          : { field: "priorityFeeLamports", built: "6", signed: "15000" },
      );
    });

    it(`v${version}: any other change refuses to send`, () => {
      const cases = [
        applyComputeBudget(message(version, 999_999n), budget),
        applyComputeBudget(message(version, 1000n, OTHER), budget),
        applyComputeBudget(
          appendTransactionMessageInstruction(
            transfer(1n),
            message(version) as Parameters<typeof appendTransactionMessageInstruction>[1],
          ) as unknown as TransactionMessage,
          budget,
        ),
      ];
      for (const changed of cases) {
        expect(compareSignedMessage(bytes(built), bytes(changed)).kind).toBe("changed");
      }
    });
  }

  it("refuses a version change and says what the refusal is", () => {
    const v0 = applyComputeBudget(message(0), { computeUnitLimit: 1200, computeUnitPrice: 0n });
    const v1 = applyComputeBudget(message(1), { computeUnitLimit: 1200, computeUnitPrice: 0n });
    expect(compareSignedMessage(bytes(v0), bytes(v1))).toEqual({
      kind: "changed",
      reason: "the transaction version",
    });
    expect(WALLET_CHANGED_TRANSACTION).toBe(
      "Your wallet changed this transaction. It was not sent.",
    );
  });

  it("adds the ComputeBudget program key for a wallet that adds its own budget to a bare message", () => {
    const bare = message(0) as V0;
    const phantom = setTransactionMessageComputeUnitPrice(
      75_000n,
      setTransactionMessageComputeUnitLimit(200_000, bare),
    );
    const before = getCompiledTransactionMessageDecoder().decode(bytes(bare));
    const after = getCompiledTransactionMessageDecoder().decode(bytes(phantom));
    expect(after.staticAccounts.length).toBe(before.staticAccounts.length + 1);
    expect(compareSignedMessage(bytes(bare), bytes(phantom))).toMatchObject({
      kind: "compute_budget_only",
    });
  });
});

/** An RPC stand in for preparation: recent fees, a blockhash and one simulation result. */
function fakeRpc(simulation: {
  err?: unknown;
  unitsConsumed?: bigint;
  loadedAccountsDataSize?: number;
}) {
  const simulated: string[] = [];
  const rpc = {
    getRecentPrioritizationFees: () => ({
      send: async () =>
        [10n, 20n, 30n, 40n].map((prioritizationFee) => ({ prioritizationFee, slot: 1n })),
    }),
    getLatestBlockhash: () => ({
      send: async () => ({ value: { blockhash: BLOCKHASH, lastValidBlockHeight: 100n } }),
    }),
    simulateTransaction: (wire: string) => {
      simulated.push(wire);
      return {
        send: async () => ({
          value: {
            err: simulation.err ?? null,
            logs: ["log"],
            unitsConsumed: simulation.unitsConsumed,
            loadedAccountsDataSize: simulation.loadedAccountsDataSize,
          },
        }),
      };
    },
  };
  return { rpc: rpc as unknown as SolanaRpc, simulated };
}

describe("preparation (06 section 9)", () => {
  it("simulates with the maximum limits, then sets the limit at 120 percent and the p75 fee", async () => {
    const { rpc, simulated } = fakeRpc({ unitsConsumed: 1000n, loadedAccountsDataSize: 5000 });
    const v0 = await prepareTransaction({
      rpc,
      version: 0,
      feePayer: PAYER,
      instructions: [transfer(5n)],
    });
    expect(v0.prepared.budget).toEqual({ computeUnitLimit: 1200, computeUnitPrice: 30n });
    expect(getTransactionMessageComputeUnitLimit(v0.message)).toBe(1200);
    const wire = getTransactionDecoder().decode(getBase64Encoder().encode(simulated[0] ?? ""));
    const simulatedMessage = decompileTransactionMessage(
      getCompiledTransactionMessageDecoder().decode(wire.messageBytes),
    );
    expect(getTransactionMessageComputeUnitLimit(simulatedMessage)).toBe(MAX_COMPUTE_UNIT_LIMIT);

    const v1 = await prepareTransaction({
      rpc,
      version: 1,
      feePayer: PAYER,
      instructions: [transfer(5n)],
    });
    expect(v1.prepared.budget).toEqual({
      computeUnitLimit: 1200,
      computeUnitPrice: 30n,
      loadedAccountsDataSizeLimit: 6000,
    });
    expect(getTransactionMessageLoadedAccountsDataSizeLimit(v1.message)).toBe(6000);
    expect(getTransactionMessagePriorityFeeLamports(v1.message as V1)).toBe(1n);
  });

  it("throws the decoded failure of a simulation and refuses a simulation without units", async () => {
    const failing = fakeRpc({
      err: { InstructionError: [0n, { Custom: 1n }] },
      unitsConsumed: 150n,
    });
    const error = await prepareTransaction({
      rpc: failing.rpc,
      version: 0,
      feePayer: PAYER,
      instructions: [transfer(5n)],
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SimulationFailedError);
    // Kit appends the ComputeBudget instructions after the app's, so the transfer is instruction 0.
    expect((error as SimulationFailedError).decoded).toMatchObject({
      code: "system_1",
      instructionIndex: 0,
    });
    expect((error as SimulationFailedError).logs).toEqual(["log"]);

    const silent = fakeRpc({ unitsConsumed: 0n });
    await expect(
      prepareTransaction({
        rpc: silent.rpc,
        version: 0,
        feePayer: PAYER,
        instructions: [transfer(5n)],
      }),
    ).rejects.toThrow("did not report compute units");
  });
});

function statusRpc(statuses: ({ confirmationStatus: string; err: unknown } | null)[]) {
  let call = 0;
  return {
    getSignatureStatuses: () => ({
      send: async () => ({ value: [statuses[Math.min(call++, statuses.length - 1)] ?? null] }),
    }),
  } as unknown as SolanaRpc;
}

describe("confirmation: confirmed for progress, finalized for the settled state", () => {
  const signature = "5".repeat(88) as Signature;

  it("returns at confirmed, or waits for finalized", async () => {
    await waitForConfirmation(
      statusRpc([null, { confirmationStatus: "confirmed", err: null }]),
      signature,
      5000,
    );
    const rpc = statusRpc([
      { confirmationStatus: "confirmed", err: null },
      { confirmationStatus: "finalized", err: null },
    ]);
    await waitForConfirmation(rpc, signature, 5000, "finalized");
    await expect(
      waitForConfirmation(
        statusRpc([{ confirmationStatus: "confirmed", err: null }]),
        signature,
        1200,
        "finalized",
      ),
    ).rejects.toThrow("was not finalized");
  });

  it("reports a failed transaction with its decoded error", async () => {
    const error = await waitForConfirmation(
      statusRpc([{ confirmationStatus: "confirmed", err: "InsufficientFundsForFee" }]),
      signature,
      5000,
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TransactionFailedError);
    expect((error as Error).message).toContain("does not have enough SOL to pay the network fee");
  });
});
