// Worker configuration from the environment (14 section 2). Error messages name the variable and the
// rule it breaks, never its value.
import { isAddress, type Address } from "@solana/kit";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

type Env = Readonly<Record<string, string | undefined>>;

export type SasConfig = {
  /** Path to the SAS signer keypair file (devnet and localnet; mainnet uses a KMS key). */
  sasSignerKeypair: string | null;
  sasCredentialAddress: Address | null;
  sasSchemaAddress: Address | null;
};

export type WorkerConfig = SasConfig & { rpcUrl: string };

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

function optional(env: Env, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function optionalAddress(env: Env, name: string): Address | null {
  const value = optional(env, name);
  if (value === null) return null;
  if (!isAddress(value)) throw new ConfigError(`${name} is not a valid address`);
  return value;
}

/** RPC_URL must be exactly one https URL; plain http is allowed only for a local validator. */
export function parseRpcUrl(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new ConfigError("RPC_URL is not set");
  if (/\s/.test(trimmed) || trimmed.split("://").length !== 2) {
    throw new ConfigError("RPC_URL must be a single URL");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ConfigError("RPC_URL is not a valid URL");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    throw new ConfigError("RPC_URL must use https (http only for a local validator)");
  }
  return trimmed;
}

export function readSasConfig(env: Env = process.env): SasConfig {
  return {
    sasSignerKeypair: optional(env, "SAS_SIGNER_KEYPAIR"),
    sasCredentialAddress: optionalAddress(env, "SAS_CREDENTIAL_ADDRESS"),
    sasSchemaAddress: optionalAddress(env, "SAS_SCHEMA_ADDRESS"),
  };
}

export function loadWorkerConfig(env: Env = process.env): WorkerConfig {
  return { rpcUrl: parseRpcUrl(env.RPC_URL), ...readSasConfig(env) };
}
