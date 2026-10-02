// The words of an organization's asset (step 4.3, D-29) for its pages, PDFs, exports and /v/: every
// amount shows the organization's own symbol, and nothing holding devUSD says USDC (founder,
// 2026-10-02). No React, no server only imports.
import {
  ASSET_WORDS,
  DEVNET_TEST_ASSET_BADGE,
  DEVNET_TEST_ASSET_TOOLTIP,
  type AssetId,
  type AssetSymbol,
} from "@sotto/sdk/cluster/assets";
import { formatTokenAmount } from "@sotto/sdk/confidential/public";

export { DEVNET_TEST_ASSET_BADGE, DEVNET_TEST_ASSET_TOOLTIP };

/** What a page needs to name an asset: network.asset on the pages, ASSET_WORDS elsewhere. */
export type AssetWords = { symbol: AssetSymbol; wrappedSymbol: string; devnetTestAsset: boolean };

export const assetWords = (id: AssetId): AssetWords => ASSET_WORDS[id];

/** Every registry asset has 6 decimals (assets.ts). */
const DECIMALS = 6;

/** "12.5 USDC", "48200 devUSD": an amount of the asset. */
export const formatAmount = (base: bigint, words: AssetWords) =>
  `${formatTokenAmount(base, DECIMALS)} ${words.symbol}`;

/** "30 wUSDC", "30 wdevUSD": an amount of the wrapped token. */
export const formatWrapped = (base: bigint, words: AssetWords) =>
  `${formatTokenAmount(base, DECIMALS)} ${words.wrappedSymbol}`;
