// The persistent network label of the app shell (13 A25): the product says "Devnet" during the beta
// and never shows "Mainnet" (devnet beta rule, D-01, D-17).
export function networkLabel(cluster: string | undefined): string {
  return cluster === "localnet" ? "Localnet" : "Devnet";
}
