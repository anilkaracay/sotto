// Confidential account reads (06, AC-03.4). Decryption needs secret keys: call these only where the
// keys already live (the crypto worker or a local script), never on a server (ENGINEERING-RULES.md rule 4).
export {
  associatedTokenAccount,
  ConfidentialAccountError,
  formatTokenAmount,
  readConfidentialBalance,
  type ConfidentialBalance,
} from "./balance.ts";
