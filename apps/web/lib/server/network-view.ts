// What the setup and overview pages need to know about the network, read on the server at every page
// load with the server's RPC: the startup verification of 06 section 0 (programs, the wrapped USDC mint,
// v1 support), the USDC mint's token program and decimals, and the labels of 13 A25 (the network label
// and "devnet test wrap" for assets of Sotto's Token Wrap deployment, D-01). The browser gets public
// values only. A network that cannot be reached shows as such; the keys still work without it. Since
// step 2.9 every /app page loads it for the shell's banner (F-19), with the proof program's health
// from the worker's verdict (program-health.ts). Since step 4.3 (D-29) it describes one asset: the
// organization's when the page belongs to one, else the default (USDC); its mints, decimals and
// words, and the registry for the account setup's choice.
import {
  ASSET_WORDS,
  DEFAULT_ASSET,
  type AssetConfig,
  type AssetId,
  type AssetSymbol,
} from "@sotto/sdk/cluster/assets";
import { verifyCluster } from "@sotto/sdk/cluster/verify";
import { readMintInfo } from "@sotto/sdk/confidential/public";
import type { SolanaRpc } from "@sotto/sdk/tx";
import { networkLabel } from "../network.ts";
import { serverRpc } from "./chain.ts";
import { orgAssetId } from "./assets.ts";
import { clusterAsset, serverCluster } from "./cluster.ts";
import type { Database } from "@sotto/db";
import { getDb } from "./db.ts";
import { log } from "./log.ts";
import { readProgramHealth, type ProgramHealth } from "./program-health.ts";

export type NetworkCheck =
  | { status: "ok" }
  | { status: "unreachable" }
  | { status: "programs_missing"; programs: string[] }
  | { status: "not_configured" }
  | { status: "wrapped_missing"; address: string }
  | { status: "wrapped_invalid"; reason: string };

/** An asset's words for the browser (no secret; the addresses are on the view itself). */
export type AssetView = {
  id: AssetId;
  symbol: AssetSymbol;
  wrappedSymbol: string;
  displayName: string;
  /** devUSD: the "Devnet test dollar" badge goes wherever it appears. */
  devnetTestAsset: boolean;
};

export function assetView(asset: Pick<AssetConfig, "id"> | AssetId): AssetView {
  const id = typeof asset === "string" ? asset : asset.id;
  return { id, ...ASSET_WORDS[id] };
}

export type NetworkView =
  | { available: false; label: string; asset: AssetView }
  | {
      available: true;
      cluster: "localnet" | "devnet";
      label: string;
      /** The Wallet Standard chain the wallet signs for. */
      chain: "solana:localnet" | "solana:devnet";
      /** "devnet test wrap": the label of every asset wrapped by Sotto's Token Wrap deployment. */
      wrapLabel: string;
      tokenWrapProgram: string;
      /** The asset this view describes, and the cluster's registry (step 4.3). */
      asset: AssetView;
      assets: AssetView[];
      /** The asset's classic SPL mint and token program, and its wrapped Token-2022 mint. */
      baseMint: string | null;
      baseTokenProgram: string | null;
      wrappedMint: string | null;
      decimals: number | null;
      /** Whether the RPC serves version 1 transactions (the wallet must declare them too, D-26). */
      v1: boolean;
      check: NetworkCheck;
      /** F-19: the ZK ElGamal Proof program's health from the worker's last verdict. */
      proofProgram: ProgramHealth;
    };

export async function loadNetworkView(
  options: { orgId?: string } = {},
  rpc: () => SolanaRpc = serverRpc,
  db: () => Database = getDb,
): Promise<NetworkView> {
  const cluster = await serverCluster();
  const assetId = options.orgId ? await orgAssetId(db(), options.orgId) : DEFAULT_ASSET;
  if (!cluster) {
    return { available: false, label: networkLabel(undefined), asset: assetView(assetId) };
  }
  const { config } = cluster;
  const proofProgram = await readProgramHealth(db(), config.name);
  const asset = clusterAsset(cluster, assetId);
  const base = {
    available: true as const,
    cluster: config.name,
    label: networkLabel(config.name),
    chain: config.name === "localnet" ? ("solana:localnet" as const) : ("solana:devnet" as const),
    wrapLabel: config.tokenWrapLabel,
    tokenWrapProgram: config.programs.tokenWrap,
    asset: assetView(assetId),
    assets: cluster.assets.map(assetView),
    baseMint: asset?.baseMint ?? null,
    wrappedMint: asset?.wrappedMint ?? null,
    proofProgram,
  };
  try {
    const client = rpc();
    const [startup, usdc] = await Promise.all([
      verifyCluster(client, config, {
        usdcMint: asset?.baseMint ?? null,
        wrappedUsdcMint: asset?.wrappedMint ?? null,
      }),
      asset ? readMintInfo(client, asset.baseMint) : Promise.resolve(null),
    ]);
    const missing = startup.programs
      .filter((program) => !program.executable)
      .map((program) => program.name);
    const wrapped = startup.wrappedMint;
    const check: NetworkCheck =
      missing.length > 0
        ? { status: "programs_missing", programs: missing }
        : wrapped.status === "ok"
          ? { status: "ok" }
          : wrapped.status === "not_configured"
            ? { status: "not_configured" }
            : wrapped.status === "missing"
              ? { status: "wrapped_missing", address: wrapped.address }
              : wrapped.status === "mismatch"
                ? { status: "wrapped_invalid", reason: "its address is not the derived one" }
                : { status: "wrapped_invalid", reason: wrapped.reason };
    return {
      ...base,
      baseTokenProgram: usdc?.programAddress ?? null,
      decimals: usdc?.decimals ?? null,
      v1: startup.v1,
      check,
    };
  } catch (error) {
    log("warn", "network_check_failed", { error });
    return {
      ...base,
      baseTokenProgram: null,
      decimals: null,
      v1: false,
      check: { status: "unreachable" },
    };
  }
}
