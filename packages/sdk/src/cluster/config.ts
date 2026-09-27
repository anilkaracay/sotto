// Per cluster configuration (docs/14-ENVIRONMENTS-DEPLOY.md section 1).
// Values are the ones verified by Gate G1 (docs/02-VERIFIED-FACTS.md). Program IDs come from package
// constants where the package exports one; the Token Wrap program and the wrapped mint are per cluster
// values (D-01, facts C5, C8). The SAS program ID is the verified value from facts E3: this package must
// not import sas-lib (D-24); apps/worker tests that it still equals the sas-lib constant. Localnet
// loads SAS by cloning it from devnet (scripts/localnet.sh).
import { address, type Address } from "@solana/kit";
import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS } from "@solana-program/zk-elgamal-proof";

export type ClusterName = "localnet" | "devnet" | "mainnet";

/** Label the UI shows for assets wrapped by the Sotto test deployment of Token Wrap (D-01). */
export const DEVNET_TEST_WRAP_LABEL = "devnet test wrap";

export interface AvailableClusterConfig {
  readonly name: "localnet" | "devnet";
  readonly available: true;
  readonly programs: {
    readonly token2022: Address;
    readonly zkElGamalProof: Address;
    /** Sotto patched test deployment, not canonical Token Wrap (facts C8). */
    readonly tokenWrap: Address;
    /** Cloned from devnet on localnet (scripts/localnet.sh). */
    readonly sas: Address;
  };
  /** Null on localnet: every local ledger has its own genesis hash. */
  readonly genesisHash: string | null;
  /**
   * The Sotto SAS credential and its sotto.business.v1 schema (08 section 5, facts E7). Null on
   * localnet: the worker's bootstrap:sas creates them per ledger under its own signer.
   */
  readonly sasCredential: Address | null;
  readonly sasBusinessSchema: Address | null;
  readonly tokenWrapLabel: typeof DEVNET_TEST_WRAP_LABEL;
  /** Null on localnet: the bootstrap script creates a local USDC-like mint. */
  readonly usdcMint: Address | null;
  /** Null on localnet: derived and created at bootstrap. */
  readonly wrappedUsdcMint: Address | null;
}

export interface UnavailableClusterConfig {
  readonly name: "mainnet";
  readonly available: false;
  readonly reason: string;
}

export type ClusterConfig = AvailableClusterConfig | UnavailableClusterConfig;

const SOTTO_TOKEN_WRAP_TEST_PROGRAM = address("EEvqpjNRQkNRwXzVziuTGGi1wYDiPv7haYVVu3XZCoQn");
const SAS_PROGRAM = address("22zoJMtdu4tQc2PzL74ZUT7FrwgB1Udec8DdW4yw4BdG");

/** Genesis hashes (facts H6): they tell which cluster an RPC endpoint serves. */
export const GENESIS_HASHES = {
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
} as const;

/** The public cluster a genesis hash belongs to; anything else is a local or unknown ledger. */
export function clusterFromGenesisHash(genesisHash: string): "devnet" | "mainnet" | "other" {
  if (genesisHash === GENESIS_HASHES.devnet) return "devnet";
  if (genesisHash === GENESIS_HASHES.mainnet) return "mainnet";
  return "other";
}

export const clusters: Readonly<Record<ClusterName, ClusterConfig>> = {
  localnet: {
    name: "localnet",
    available: true,
    programs: {
      token2022: TOKEN_2022_PROGRAM_ADDRESS,
      zkElGamalProof: ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
      tokenWrap: SOTTO_TOKEN_WRAP_TEST_PROGRAM,
      sas: SAS_PROGRAM,
    },
    genesisHash: null,
    sasCredential: null,
    sasBusinessSchema: null,
    tokenWrapLabel: DEVNET_TEST_WRAP_LABEL,
    usdcMint: null,
    wrappedUsdcMint: null,
  },
  devnet: {
    name: "devnet",
    available: true,
    programs: {
      token2022: TOKEN_2022_PROGRAM_ADDRESS,
      zkElGamalProof: ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
      tokenWrap: SOTTO_TOKEN_WRAP_TEST_PROGRAM,
      sas: SAS_PROGRAM,
    },
    genesisHash: GENESIS_HASHES.devnet,
    sasCredential: address("4KX4P7he62x5x8X35vubNNhJRhV4vJXPGNsc8skPyKFT"),
    sasBusinessSchema: address("A4PX8yuPQYeZFqtPomd5E3Jce7dTuWktcnpzb9YCM4z3"),
    tokenWrapLabel: DEVNET_TEST_WRAP_LABEL,
    usdcMint: address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
    wrappedUsdcMint: address("AhJfP4JJBaHWRtXRiaScZUC7SMm4RqUPSb3g9H5RT8Bd"),
  },
  mainnet: {
    name: "mainnet",
    available: false,
    reason:
      "Sotto runs on devnet only during the beta. The mainnet asset is decided after the hackathon (D-01).",
  },
};

export function getClusterConfig(name: ClusterName): ClusterConfig {
  return clusters[name];
}
