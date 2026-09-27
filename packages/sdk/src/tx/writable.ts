import { isWritableRole, type Address, type Instruction } from "@solana/kit";

/** The writable accounts of the instructions, for the priority fee sample (06 section 9). */
export function writableAccounts(instructions: readonly Instruction[]): Address[] {
  const seen = new Set<Address>();
  for (const instruction of instructions) {
    for (const meta of instruction.accounts ?? []) {
      if (isWritableRole(meta.role)) seen.add(meta.address);
    }
  }
  return [...seen];
}
