// Display helpers shared by server and client components.

/** A wallet address as its first and last four characters. */
export function shortWallet(wallet: string): string {
  return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
}
