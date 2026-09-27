// Display helpers shared by server and client components.

/** A wallet address as its first and last four characters. */
export function shortWallet(wallet: string): string {
  return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
}

// Month names are fixed here rather than taken from Intl: locale data can differ between Node and the
// browser (Node 24 formats en-GB September as "Sept"), and a difference breaks hydration.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A date as "27 Sep 2026" (UTC), the same on the server and in the browser. */
export function formatDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}
