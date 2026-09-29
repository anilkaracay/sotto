// What the chain shows about a token account (step 2.5, 08 section 4, AC-05.3), from transactions
// built here and encoded as the RPC returns them: a deposit keeps its public amount, only for the
// account it names; a public transfer is read in both directions with the other account and no amount;
// other programs and instructions for other accounts are not activity of the account; a version 0
// transaction with lookup tables is reported, not read. The real instructions of every Sotto flow, in
// version 0 and version 1 transactions, are read on localnet (chain-localnet.test.ts).
import { getTransferSolInstruction } from "@solana-program/system";
import {
  getConfidentialDepositInstruction,
  getTransferCheckedInstruction,
} from "@solana-program/token-2022";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import { activityOf } from "../src/chain/activity.ts";
import { applyComputeBudget, SIMULATION_BUDGET } from "../src/tx/index.ts";

const ACCOUNT = address("HmEvErXi8iX36Qi9ow6qb7MAUijbiHSUXx7Tiqvq3Srq");
const OTHER = address("3tsDBjBsSycu8Hp1XtQqGqGixNXgWQFyRKRfSXp2sDb6");
const MINT = address("EnGvQ7aUW3r1pE1xfHXURfwHpnfhUhEtYChX8hfextDT");
const TABLE = address("AaP2561CRozEb9ZxW3WPp5PjoqREN6HCc8D2kJFLbqzq");
const WRAP = address("EEvqpjNRQkNRwXzVziuTGGi1wYDiPv7haYVVu3XZCoQn");
const OWNER = createNoopSigner(address("Ci7TjqvMZDxoicQjgbjdt5jYjpJfvdUGanZ6Fj3pMsm3"));
const LIFETIME = {
  blockhash: "5ud3kY17PCk6srqcevVnmPk22xPBXHzVvX3fzTaGp4Yx" as Blockhash,
  lastValidBlockHeight: 100n,
};

function wire(instructions: Instruction[], version: 0 | 1): Uint8Array {
  const message = applyComputeBudget(
    pipe(
      createTransactionMessage({ version }),
      (m) => setTransactionMessageFeePayer(OWNER.address, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(LIFETIME, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    ),
    SIMULATION_BUDGET,
  );
  return new Uint8Array(
    getBase64Encoder().encode(getBase64EncodedWireTransaction(compileTransaction(message))),
  );
}

/** A version 0 transaction that loads accounts from lookup tables. */
function wireWithTables(
  instructions: Instruction[],
  tables: Record<Address, Address[]>,
): Uint8Array {
  const message = compressTransactionMessageUsingAddressLookupTables(
    pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(OWNER.address, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(LIFETIME, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    ),
    tables,
  );
  return new Uint8Array(
    getBase64Encoder().encode(getBase64EncodedWireTransaction(compileTransaction(message))),
  );
}

const deposit = (token: Address) =>
  getConfidentialDepositInstruction({
    token,
    mint: MINT,
    authority: OWNER,
    amount: 20_000_000n,
    decimals: 6,
  });

const transfer = (source: Address, destination: Address) =>
  getTransferCheckedInstruction({
    source,
    mint: MINT,
    destination,
    authority: OWNER,
    amount: 5_000_000n,
    decimals: 6,
  });

const read = (bytes: Uint8Array) =>
  activityOf({ wire: bytes, account: ACCOUNT, tokenWrapProgram: WRAP });

describe("what the chain shows (step 2.5)", () => {
  it("AC-05.3 keeps a deposit's public amount for the account it names, in version 0 and version 1", () => {
    for (const version of [0, 1] as const) {
      expect(read(wire([deposit(OTHER), deposit(ACCOUNT)], version))).toEqual({
        kind: "read",
        activity: [
          { instructionIndex: 1, type: "deposit", counterparty: null, publicAmount: 20_000_000n },
        ],
      });
    }
  });

  it("AC-05.3 reads a public transfer both ways with the other account and without its amount", () => {
    expect(read(wire([transfer(ACCOUNT, OTHER), transfer(OTHER, ACCOUNT)], 1))).toEqual({
      kind: "read",
      activity: [
        {
          instructionIndex: 0,
          type: "public_transfer_out",
          counterparty: OTHER,
          publicAmount: null,
        },
        {
          instructionIndex: 1,
          type: "public_transfer_in",
          counterparty: OTHER,
          publicAmount: null,
        },
      ],
    });
  });

  it("finds no activity in other programs and in instructions for other accounts", () => {
    expect(
      read(
        wire(
          [
            getTransferSolInstruction({ source: OWNER, destination: ACCOUNT, amount: 1n }),
            deposit(OTHER),
          ],
          0,
        ),
      ),
    ).toEqual({ kind: "read", activity: [] });
  });

  it("reports a version 0 transaction with lookup tables instead of reading it", () => {
    expect(read(wireWithTables([transfer(ACCOUNT, OTHER)], { [TABLE]: [OTHER] }))).toEqual({
      kind: "lookup_tables",
    });
  });
});
