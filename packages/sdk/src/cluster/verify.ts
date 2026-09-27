// Startup verification (06 section 0), for every app load and worker start on the active cluster:
// 1. the cluster's programs are executable accounts;
// 2. the wrapped USDC mint, derived from (USDC mint, Token-2022) under the cluster's Token Wrap program,
//    exists and has ConfidentialTransferMint with no auditor (facts C2);
// 3. the RPC answers getLatestBlockhash and a getBlock with maxSupportedTransactionVersion 1.
// Failure of 1 or 2 disables confidential features (the app shows a banner; a missing wrapped mint can
// be created, permissionless); failure of 3 switches to the v0 path with a warning. It only reads.
import { fetchMaybeMint, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import type { Address } from "@solana/kit";
import type { SolanaRpc } from "../tx/rpc.ts";
import { wrappedMintAddress } from "../wrap/index.ts";
import type { AvailableClusterConfig } from "./config.ts";

export type ProgramCheck = { name: string; address: Address; executable: boolean };

export type WrappedMintCheck =
  | { status: "ok"; address: Address }
  | { status: "not_configured" }
  | { status: "missing"; address: Address }
  | { status: "mismatch"; address: Address; configured: Address }
  | { status: "invalid"; address: Address; reason: string };

export type StartupCheck = {
  programs: ProgramCheck[];
  wrappedMint: WrappedMintCheck;
  v1: boolean;
  confidentialEnabled: boolean;
  transactionPath: "v1" | "v0";
};

async function checkPrograms(
  rpc: SolanaRpc,
  config: AvailableClusterConfig,
): Promise<ProgramCheck[]> {
  const entries = Object.entries(config.programs) as [string, Address][];
  const { value } = await rpc
    .getMultipleAccounts(
      entries.map(([, address]) => address),
      { encoding: "base64", commitment: "confirmed" },
    )
    .send();
  return entries.map(([name, address], index) => ({
    name,
    address,
    executable: Boolean(value[index]?.executable),
  }));
}

async function checkWrappedMint(
  rpc: SolanaRpc,
  config: AvailableClusterConfig,
  mints: { usdcMint: Address | null; wrappedUsdcMint: Address | null },
): Promise<WrappedMintCheck> {
  if (!mints.usdcMint) return { status: "not_configured" };
  const address = await wrappedMintAddress(mints.usdcMint, config.programs.tokenWrap);
  if (mints.wrappedUsdcMint && mints.wrappedUsdcMint !== address) {
    return { status: "mismatch", address, configured: mints.wrappedUsdcMint };
  }
  const mint = await fetchMaybeMint(rpc, address, { commitment: "confirmed" });
  if (!mint.exists) return { status: "missing", address };
  if (mint.programAddress !== TOKEN_2022_PROGRAM_ADDRESS) {
    return { status: "invalid", address, reason: "it is not a Token-2022 mint" };
  }
  const extensions = mint.data.extensions.__option === "Some" ? mint.data.extensions.value : [];
  const confidential = extensions.find((item) => item.__kind === "ConfidentialTransferMint");
  if (!confidential || confidential.__kind !== "ConfidentialTransferMint") {
    return { status: "invalid", address, reason: "it has no ConfidentialTransferMint extension" };
  }
  if (confidential.auditorElgamalPubkey.__option === "Some") {
    return { status: "invalid", address, reason: "it has an auditor key" };
  }
  return { status: "ok", address };
}

async function checkV1(rpc: SolanaRpc): Promise<boolean> {
  try {
    await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
    const slot = await rpc.getSlot({ commitment: "finalized" }).send();
    const slots = await rpc
      .getBlocks(slot > 20n ? slot - 20n : 0n, slot, { commitment: "finalized" })
      .send();
    const last = slots.at(-1);
    if (last === undefined) return false;
    await rpc
      .getBlock(last, {
        maxSupportedTransactionVersion: 1,
        transactionDetails: "none",
        rewards: false,
        commitment: "finalized",
      })
      .send();
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs the three checks. `mints` overrides the configured USDC and wrapped mints (localnet, where the
 * bootstrap creates them).
 */
export async function verifyCluster(
  rpc: SolanaRpc,
  config: AvailableClusterConfig,
  mints: { usdcMint: Address | null; wrappedUsdcMint: Address | null } = config,
): Promise<StartupCheck> {
  const [programs, wrappedMint, v1] = await Promise.all([
    checkPrograms(rpc, config),
    checkWrappedMint(rpc, config, mints),
    checkV1(rpc),
  ]);
  return {
    programs,
    wrappedMint,
    v1,
    confidentialEnabled:
      programs.every((program) => program.executable) && wrappedMint.status === "ok",
    transactionPath: v1 ? "v1" : "v0",
  };
}
