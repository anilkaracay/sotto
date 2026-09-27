// Instructions as plain data (04 section 5): the crypto Web Worker builds the instructions that need
// the confidential keys and posts them to the page, which prepares, signs and sends the transaction. A
// kit instruction can carry signer objects, whose functions cannot cross postMessage. The portable
// form keeps the program, the data and each account's address and role, so a signer account stays a
// signer; the wallet signs the compiled message later. Instructions carry no key material: their data
// is what the transaction publishes onchain.
import type { AccountRole, Address, Instruction } from "@solana/kit";

export type PortableInstruction = {
  programAddress: Address;
  accounts: { address: Address; role: AccountRole }[];
  data: Uint8Array;
};

export function toPortableInstruction(instruction: Instruction): PortableInstruction {
  return {
    programAddress: instruction.programAddress,
    accounts: (instruction.accounts ?? []).map(({ address, role }) => ({ address, role })),
    data: new Uint8Array(instruction.data ?? []),
  };
}
