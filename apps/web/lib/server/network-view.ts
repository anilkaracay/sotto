// What the setup and overview pages need to know about the network, read on the server at every page
// load with the server's RPC: the startup verification of 06 section 0 (programs, the wrapped USDC mint,
// v1 support), the USDC mint's token program and decimals, and the labels of 13 A25 (the network label
// and "devnet test wrap" for assets of Sotto's Token Wrap deployment, D-01). The browser gets public
// values only. A network that cannot be reached shows as such; the keys still work without it. Since
// step 2.9 every /app page loads it for the shell's banner (F-19), with the proof program's health
// from the worker's verdict (program-health.ts).
import { verifyCluster } from "@sotto/sdk/cluster/verify";
import { readMintInfo } from "@sotto/sdk/confidential/public";
import type { SolanaRpc } from "@sotto/sdk/tx";
import { networkLabel } from "../network.ts";
import { serverRpc } from "./chain.ts";
import { serverCluster } from "./cluster.ts";
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

export type NetworkView =
  | { available: false; label: string }
  | {
      available: true;
      cluster: "localnet" | "devnet";
      label: string;
      /** The Wallet Standard chain the wallet signs for. */
      chain: "solana:localnet" | "solana:devnet";
      /** "devnet test wrap": the label of every asset wrapped by Sotto's Token Wrap deployment. */
      wrapLabel: string;
      tokenWrapProgram: string;
      usdcMint: string | null;
      usdcTokenProgram: string | null;
      wrappedMint: string | null;
      decimals: number | null;
      /** Whether the RPC serves version 1 transactions (the wallet must declare them too, D-26). */
      v1: boolean;
      check: NetworkCheck;
      /** F-19: the ZK ElGamal Proof program's health from the worker's last verdict. */
      proofProgram: ProgramHealth;
    };

export async function loadNetworkView(
  rpc: () => SolanaRpc = serverRpc,
  db: () => Database = getDb,
): Promise<NetworkView> {
  const cluster = await serverCluster();
  if (!cluster) return { available: false, label: networkLabel(undefined) };
  const { config } = cluster;
  const proofProgram = await readProgramHealth(db(), config.name);
  const base = {
    available: true as const,
    cluster: config.name,
    label: networkLabel(config.name),
    chain: config.name === "localnet" ? ("solana:localnet" as const) : ("solana:devnet" as const),
    wrapLabel: config.tokenWrapLabel,
    tokenWrapProgram: config.programs.tokenWrap,
    usdcMint: cluster.usdcMint,
    wrappedMint: cluster.wrappedUsdcMint,
    proofProgram,
  };
  try {
    const client = rpc();
    const [startup, usdc] = await Promise.all([
      verifyCluster(client, config, {
        usdcMint: cluster.usdcMint,
        wrappedUsdcMint: cluster.wrappedUsdcMint,
      }),
      cluster.usdcMint ? readMintInfo(client, cluster.usdcMint) : Promise.resolve(null),
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
      usdcTokenProgram: usdc?.programAddress ?? null,
      decimals: usdc?.decimals ?? null,
      v1: startup.v1,
      check,
    };
  } catch (error) {
    log("warn", "network_check_failed", { error });
    return {
      ...base,
      usdcTokenProgram: null,
      decimals: null,
      v1: false,
      check: { status: "unreachable" },
    };
  }
}
