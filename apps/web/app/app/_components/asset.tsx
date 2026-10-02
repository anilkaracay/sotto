"use client";

// The organization's asset words for every component under the app shell (step 4.3, D-29): the shell
// provides network.asset, so amounts and account names say USDC or devUSD as the organization holds,
// and nothing holding devUSD says USDC. Outside a shell (component tests) the words are USDC's.
import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_ASSET } from "@sotto/sdk/cluster/assets";
import { assetWords, type AssetWords } from "../../../lib/asset-words.ts";

export const AssetWordsContext = createContext<AssetWords>(assetWords(DEFAULT_ASSET));

export function useAssetWords(): AssetWords {
  return useContext(AssetWordsContext);
}

/** For server pages outside the app shell (the signed out invite page). */
export function AssetWordsProvider({
  asset,
  children,
}: {
  asset: AssetWords;
  children: ReactNode;
}) {
  return <AssetWordsContext value={asset}>{children}</AssetWordsContext>;
}
