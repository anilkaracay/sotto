// The signed message check (06 section 9, Q-08): after a wallet signs, compare the message it signed
// with the message the app built.
// - identical: the same bytes; proceed.
// - compute_budget_only: the same fee payer, lifetime and instructions (program, accounts with their
//   roles, data) once ComputeBudget instructions and the ComputeBudget program key are set aside, and
//   for v1 the config values; proceed, and log the changed budget values (never amounts). A message
//   the wallet recompiled with the same content has no changes in this list.
// - changed: anything else, including other versions or address lookup tables, which Sotto does not
//   build; refuse to send: "Your wallet changed this transaction. It was not sent."
// The comparison is by content, never by wallet name (D-26).
import {
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getTransactionMessageComputeUnitLimit,
  getTransactionMessageComputeUnitPrice,
  getTransactionMessageHeapSize,
  getTransactionMessageLoadedAccountsDataSizeLimit,
  getTransactionMessagePriorityFeeLamports,
  type ReadonlyUint8Array,
  type TransactionMessage,
} from "@solana/kit";

/** The Compute Budget program (kit 8.3 transaction-messages, COMPUTE_BUDGET_PROGRAM_ADDRESS). */
export const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";

export const WALLET_CHANGED_TRANSACTION = "Your wallet changed this transaction. It was not sent.";

export type BudgetField =
  | "computeUnitLimit"
  | "computeUnitPrice"
  | "priorityFeeLamports"
  | "loadedAccountsDataSizeLimit"
  | "heapSize";

export type BudgetChange = { field: BudgetField; built: string | null; signed: string | null };

export type SignedMessageComparison =
  | { kind: "identical" }
  | { kind: "compute_budget_only"; changes: BudgetChange[] }
  | { kind: "changed"; reason: string };

function same(a: ReadonlyUint8Array | undefined, b: ReadonlyUint8Array | undefined): boolean {
  if (!a || !b) return (a?.length ?? 0) === 0 && (b?.length ?? 0) === 0;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function decode(bytes: ReadonlyUint8Array): TransactionMessage | string {
  try {
    const compiled = getCompiledTransactionMessageDecoder().decode(bytes);
    if (compiled.version === "legacy") return "legacy transactions are not built by Sotto";
    if ("addressTableLookups" in compiled && (compiled.addressTableLookups?.length ?? 0) > 0) {
      return "address lookup tables are not used by Sotto";
    }
    return decompileTransactionMessage(compiled) as TransactionMessage;
  } catch (error) {
    return `the message could not be decoded (${error instanceof Error ? error.message : String(error)})`;
  }
}

type Budget = Record<BudgetField, string | null>;

function budgetOf(message: TransactionMessage): Budget {
  const text = (value: number | bigint | undefined) => (value === undefined ? null : String(value));
  return {
    computeUnitLimit: text(getTransactionMessageComputeUnitLimit(message)),
    computeUnitPrice:
      message.version === 0 ? text(getTransactionMessageComputeUnitPrice(message)) : null,
    priorityFeeLamports:
      message.version === 1 ? text(getTransactionMessagePriorityFeeLamports(message)) : null,
    loadedAccountsDataSizeLimit: text(getTransactionMessageLoadedAccountsDataSizeLimit(message)),
    heapSize: text(getTransactionMessageHeapSize(message)),
  };
}

function withoutBudget(message: TransactionMessage) {
  return message.instructions.filter(
    (instruction) => instruction.programAddress !== COMPUTE_BUDGET_PROGRAM,
  );
}

function lifetimeOf(message: TransactionMessage): string {
  const lifetime = (message as { lifetimeConstraint?: Record<string, unknown> }).lifetimeConstraint;
  if (!lifetime) return "";
  return "blockhash" in lifetime
    ? `blockhash:${String(lifetime.blockhash)}`
    : `nonce:${String(lifetime.nonce)}`;
}

export function compareSignedMessage(
  built: ReadonlyUint8Array,
  signed: ReadonlyUint8Array,
): SignedMessageComparison {
  if (same(built, signed)) return { kind: "identical" };
  const ours = decode(built);
  if (typeof ours === "string") return { kind: "changed", reason: `built message: ${ours}` };
  const theirs = decode(signed);
  if (typeof theirs === "string") return { kind: "changed", reason: theirs };
  if (ours.version !== theirs.version)
    return { kind: "changed", reason: "the transaction version" };
  const feePayer = (message: TransactionMessage) =>
    (message as { feePayer?: { address: string } }).feePayer?.address;
  if (feePayer(ours) !== feePayer(theirs)) return { kind: "changed", reason: "the fee payer" };
  if (lifetimeOf(ours) !== lifetimeOf(theirs)) return { kind: "changed", reason: "the blockhash" };

  const a = withoutBudget(ours);
  const b = withoutBudget(theirs);
  if (a.length !== b.length) return { kind: "changed", reason: "the instructions" };
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (!x || !y || x.programAddress !== y.programAddress) {
      return { kind: "changed", reason: `instruction ${i + 1}: the program` };
    }
    if (!same(x.data, y.data)) return { kind: "changed", reason: `instruction ${i + 1}: the data` };
    const accountsX = x.accounts ?? [];
    const accountsY = y.accounts ?? [];
    if (
      accountsX.length !== accountsY.length ||
      accountsX.some(
        (account, j) =>
          account.address !== accountsY[j]?.address || account.role !== accountsY[j]?.role,
      )
    ) {
      return { kind: "changed", reason: `instruction ${i + 1}: the accounts` };
    }
  }

  const builtBudget = budgetOf(ours);
  const signedBudget = budgetOf(theirs);
  const changes = (Object.keys(builtBudget) as BudgetField[])
    .filter((field) => builtBudget[field] !== signedBudget[field])
    .map((field) => ({ field, built: builtBudget[field], signed: signedBudget[field] }));
  return { kind: "compute_budget_only", changes };
}
