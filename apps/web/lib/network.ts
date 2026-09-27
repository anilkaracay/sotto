// The persistent network label of the app shell (13 A25): the product says "Devnet" during the beta
// and never shows "Mainnet" (devnet beta rule, D-01, D-17).
export function networkLabel(cluster: string | undefined): string {
  return cluster === "localnet" ? "Localnet" : "Devnet";
}

/**
 * The label of the cluster this server runs on, read from the environment when the page renders.
 * Next.js inlines a literal process.env.NEXT_PUBLIC_CLUSTER at build time; reading it through a
 * variable keeps the server's runtime value, the one the cluster config uses (lib/server/cluster.ts).
 */
export function currentNetworkLabel(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return networkLabel(env.NEXT_PUBLIC_CLUSTER);
}
