// The web server's cluster (14 sections 1 and 2). NEXT_PUBLIC_CLUSTER names it, devnet when unset, as
// the network label reads it. Devnet values come from the verified cluster config (facts C8, F1). A
// local ledger gets a new USDC-like mint from each bootstrap, so localnet reads LOCALNET_USDC_MINT
// (server only; scripts/bootstrap-localnet.ts prints it) and derives the wrapped mint from it under the
// cluster's Token Wrap program: per cluster values, never constants (D-01). Mainnet is unavailable
// during the beta (D-01).
import { getClusterConfig, type AvailableClusterConfig } from "@sotto/sdk/cluster";
import { wrappedMintAddress } from "@sotto/sdk/wrap";
import { address, isAddress, type Address } from "@solana/kit";
import { ConfigError } from "./config.ts";

type Env = Readonly<Record<string, string | undefined>>;

export type ServerCluster = {
  config: AvailableClusterConfig;
  /** Null on localnet until LOCALNET_USDC_MINT is set. */
  usdcMint: Address | null;
  wrappedUsdcMint: Address | null;
};

/** The cluster's config and mints, or null when the cluster is unavailable (mainnet, D-01). */
export async function serverCluster(env: Env = process.env): Promise<ServerCluster | null> {
  const name = env.NEXT_PUBLIC_CLUSTER?.trim() || "devnet";
  if (name !== "localnet" && name !== "devnet" && name !== "mainnet") {
    throw new ConfigError("NEXT_PUBLIC_CLUSTER must be localnet, devnet or mainnet");
  }
  const config = getClusterConfig(name);
  if (!config.available) return null;
  if (config.usdcMint) {
    return { config, usdcMint: config.usdcMint, wrappedUsdcMint: config.wrappedUsdcMint };
  }
  const local = env.LOCALNET_USDC_MINT?.trim();
  if (!local) return { config, usdcMint: null, wrappedUsdcMint: null };
  if (!isAddress(local)) throw new ConfigError("LOCALNET_USDC_MINT must be a base58 address");
  const usdcMint = address(local);
  return {
    config,
    usdcMint,
    wrappedUsdcMint: await wrappedMintAddress(usdcMint, config.programs.tokenWrap),
  };
}
