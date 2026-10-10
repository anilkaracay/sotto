// What a new wallet's first steps share (step 4.6, D-33; the checklist that runs them since step
// 4.11 is lib/ready.ts): the faucets' amounts, the SOL a wallet needs for the account's setup, and
// the note that points to Solana's own faucet. No server only imports.

/** What the checklist asks the devUSD faucet for: 1,000,000 devUSD, the wallet's whole day. */
export const FIRST_RUN_DEVUSD = 1_000_000_000_000n;
/** With less SOL than this the account's setup cannot pay its fee and rent (0.005 SOL). */
export const FIRST_RUN_MIN_SOL = 5_000_000n;

/** Solana's own devnet faucet, for a wallet Sotto's faucet cannot serve right now (step 4.10). */
export const SOLANA_FAUCET_URL = "https://faucet.solana.com";
export const SOLANA_FAUCET_NAME = "faucet.solana.com";
/** The note's words around the link: "<before> faucet.solana.com<after>". */
export const SOL_ELSEWHERE_BEFORE =
  "Sotto's faucet cannot send this wallet test SOL right now. Get devnet SOL for it at";
export const SOL_ELSEWHERE_AFTER = ", then reload this page.";

const SOL = 1_000_000_000n;
/** "0.05": lamports as SOL, without trailing zeros. */
export function solWords(lamports: bigint): string {
  const whole = lamports / SOL;
  const fraction = (lamports % SOL).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
