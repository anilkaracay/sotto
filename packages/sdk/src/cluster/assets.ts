// The asset registry (step 4.3, D-29): the assets an organization can hold on a cluster, each a classic
// SPL mint wrapped one to one by the cluster's Token Wrap program into a Token-2022 mint with
// confidential transfers, and each with its own sotto_proofs deployment, because a sotto_proofs config
// holds one wrapped mint (docs/05-ONCHAIN-PROGRAM.md). An organization chooses one asset at account
// setup; USDC stays the default. On devnet: Circle's devnet USDC (D-01) and devUSD, a test dollar
// Sotto mints for trying Sotto with realistic amounts (no value; its mint authority is on the server,
// never in the repository or a browser).
import { address, type Address } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

export type AssetId = "usdc" | "devusd";

export const ASSET_IDS: readonly AssetId[] = ["usdc", "devusd"];

/** The default asset of an organization (D-29). */
export const DEFAULT_ASSET: AssetId = "usdc";

export interface AssetConfig {
  readonly id: AssetId;
  /** What every amount of this asset shows: "USDC", "devUSD". */
  readonly symbol: string;
  /** The wrapped token's symbol: "wUSDC", "wdevUSD". */
  readonly wrappedSymbol: string;
  readonly displayName: string;
  readonly decimals: number;
  /** The classic SPL mint and its token program. */
  readonly baseMint: Address;
  readonly baseTokenProgram: Address;
  /** The Token-2022 mint the cluster's Token Wrap program derives for baseMint. */
  readonly wrappedMint: Address;
  /** A test token issued for trying Sotto on devnet, with no value: the UI marks it (13, D-29). */
  readonly devnetTestAsset: boolean;
  /** This asset's sotto_proofs deployment and config PDA, null where none is deployed. */
  readonly sottoProofs: { readonly program: Address; readonly config: Address } | null;
}

/** The words and marks of an asset, without addresses (what any page may show). */
export const ASSET_WORDS: Readonly<
  Record<AssetId, Pick<AssetConfig, "symbol" | "wrappedSymbol" | "displayName" | "devnetTestAsset">>
> = {
  usdc: { symbol: "USDC", wrappedSymbol: "wUSDC", displayName: "USDC", devnetTestAsset: false },
  devusd: {
    symbol: "devUSD",
    wrappedSymbol: "wdevUSD",
    displayName: "Sotto Devnet Test Dollar",
    devnetTestAsset: true,
  },
};

/** The badge and tooltip shown wherever a devnet test asset appears (founder, 2026-10-02). */
export const DEVNET_TEST_ASSET_BADGE = "Devnet test dollar";
export const DEVNET_TEST_ASSET_TOOLTIP = "A test token for trying Sotto on devnet. It has no value.";

export function isAssetId(value: unknown): value is AssetId {
  return typeof value === "string" && (ASSET_IDS as readonly string[]).includes(value);
}

/** An asset entry from its id and addresses, with the shared words and 6 decimals. */
export function assetConfig(
  id: AssetId,
  addresses: {
    baseMint: Address;
    wrappedMint: Address;
    sottoProofs: AssetConfig["sottoProofs"];
  },
): AssetConfig {
  return {
    id,
    ...ASSET_WORDS[id],
    decimals: 6,
    baseTokenProgram: TOKEN_PROGRAM_ADDRESS,
    ...addresses,
  };
}

/** Devnet USDC (D-01; facts C8, N1), unchanged. */
export const DEVNET_USDC: AssetConfig = assetConfig("usdc", {
  baseMint: address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
  wrappedMint: address("AhJfP4JJBaHWRtXRiaScZUC7SMm4RqUPSb3g9H5RT8Bd"),
  sottoProofs: {
    program: address("4rMKgJWgawaTTdUxaudUXthEExnRZ7AvFvqzsoEAr9jd"),
    config: address("Gxhkhq4QDvv2y2GK7ZjHF1J8rThwsSdfxDziMCdWFnFe"),
  },
});
