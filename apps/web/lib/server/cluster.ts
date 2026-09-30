// The web server's cluster (14 sections 1 and 2). NEXT_PUBLIC_CLUSTER names it, devnet when unset, as
// the network label reads it. Devnet values come from the verified cluster config (facts C8, F1). A
// local ledger gets a new USDC-like mint from each bootstrap, so localnet reads LOCALNET_USDC_MINT
// (server only; scripts/bootstrap-localnet.ts prints it) and derives the wrapped mint from it under the
// cluster's Token Wrap program: per cluster values, never constants (D-01). Mainnet is unavailable
// during the beta (D-01). Step 2.8: the sotto_proofs deployment and the SAS credential and schema the
// public proof page reads, from the cluster config on devnet (facts N1, E7) and, since each local
// ledger has its own, from LOCALNET_SOTTO_PROOFS_PROGRAM, LOCALNET_SAS_CREDENTIAL and
// LOCALNET_SAS_SCHEMA on localnet (server only; .localnet/bootstrap.json holds them).
import { getClusterConfig, type AvailableClusterConfig } from "@sotto/sdk/cluster";
import { findConfigPda } from "@sotto/sdk/proofs";
import { wrappedMintAddress } from "@sotto/sdk/wrap";
import { address, isAddress, type Address } from "@solana/kit";
import { ConfigError } from "./config.ts";

type Env = Readonly<Record<string, string | undefined>>;

export type ServerCluster = {
  config: AvailableClusterConfig;
  /** Null on localnet until LOCALNET_USDC_MINT is set. */
  usdcMint: Address | null;
  wrappedUsdcMint: Address | null;
  /** The sotto_proofs program and its config PDA; null on localnet until it is deployed and named. */
  sottoProofs: { program: Address; config: Address } | null;
  /** The SAS program with the Sotto credential and business schema; null on localnet until named. */
  sas: { program: Address; credential: Address; schema: Address } | null;
};

function optionalAddress(env: Env, name: string): Address | null {
  const value = env[name]?.trim();
  if (!value) return null;
  if (!isAddress(value)) throw new ConfigError(`${name} must be a base58 address`);
  return address(value);
}

async function proofsAndSas(
  config: AvailableClusterConfig,
  env: Env,
): Promise<Pick<ServerCluster, "sottoProofs" | "sas">> {
  let sottoProofs = config.sottoProofs;
  const localProgram = config.sottoProofs
    ? null
    : optionalAddress(env, "LOCALNET_SOTTO_PROOFS_PROGRAM");
  if (localProgram) {
    const [programConfig] = await findConfigPda({ programAddress: localProgram });
    sottoProofs = { program: localProgram, config: programConfig };
  }
  const credential = config.sasCredential ?? optionalAddress(env, "LOCALNET_SAS_CREDENTIAL");
  const schema = config.sasBusinessSchema ?? optionalAddress(env, "LOCALNET_SAS_SCHEMA");
  return {
    sottoProofs,
    sas: credential && schema ? { program: config.programs.sas, credential, schema } : null,
  };
}

/** The cluster's config and mints, or null when the cluster is unavailable (mainnet, D-01). */
export async function serverCluster(env: Env = process.env): Promise<ServerCluster | null> {
  const name = env.NEXT_PUBLIC_CLUSTER?.trim() || "devnet";
  if (name !== "localnet" && name !== "devnet" && name !== "mainnet") {
    throw new ConfigError("NEXT_PUBLIC_CLUSTER must be localnet, devnet or mainnet");
  }
  const config = getClusterConfig(name);
  if (!config.available) return null;
  const extra = await proofsAndSas(config, env);
  if (config.usdcMint) {
    return { config, usdcMint: config.usdcMint, wrappedUsdcMint: config.wrappedUsdcMint, ...extra };
  }
  const local = env.LOCALNET_USDC_MINT?.trim();
  if (!local) return { config, usdcMint: null, wrappedUsdcMint: null, ...extra };
  if (!isAddress(local)) throw new ConfigError("LOCALNET_USDC_MINT must be a base58 address");
  const usdcMint = address(local);
  return {
    config,
    usdcMint,
    wrappedUsdcMint: await wrappedMintAddress(usdcMint, config.programs.tokenWrap),
    ...extra,
  };
}
