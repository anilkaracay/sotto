// Confidential accounts (06 sections 3 and 4, AC-03.3, AC-03.4, AC-04.x). Decryption and the setup and
// apply instructions need secret keys: import this entry only where the keys already live (the crypto
// worker or a local script), never on a server (ENGINEERING-RULES.md rule 4). Pages, servers and the worker job
// use `@sotto/sdk/confidential/public`, which loads no WASM.
export {
  applyPendingBalanceInstruction,
  confidentialAccountSetupInstructions,
  decryptTokenAccount,
  type DecryptedBalance,
} from "./account.ts";
export { readConfidentialBalance, type ConfidentialBalance } from "./balance.ts";
export { checkProofProgram, type ProofProgramCheck } from "./health.ts";
export { confidentialTransferPlan, type ConfidentialTransferPlan } from "./transfer.ts";
export * from "./public.ts";
