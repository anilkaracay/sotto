// Links to the Solana Explorer (step 4.6): where a visitor checks a transfer, an account or a proof
// record on the chain itself. A local ledger has no public explorer, so it gets no link.

export type ExplorerTarget = "tx" | "address";

/** The explorer's page for a transaction signature or an address on `cluster`, or null on localnet. */
export function explorerUrl(
  target: ExplorerTarget,
  value: string,
  cluster: "localnet" | "devnet" | "mainnet",
): string | null {
  if (cluster === "localnet") return null;
  const base = `https://explorer.solana.com/${target}/${encodeURIComponent(value)}`;
  return cluster === "devnet" ? `${base}?cluster=devnet` : base;
}
