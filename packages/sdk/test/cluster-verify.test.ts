// The startup verification of 06 section 0 against an RPC stand in that serves real account bytes.
import { extension, getMintEncoder, TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { address, none, some, type Address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { getClusterConfig, type AvailableClusterConfig } from "../src/cluster/config.ts";
import { verifyCluster } from "../src/cluster/verify.ts";
import type { SolanaRpc } from "../src/tx/rpc.ts";
import { wrappedMintAddress } from "../src/wrap/index.ts";

const devnet = getClusterConfig("devnet") as AvailableClusterConfig;
const USDC = devnet.usdcMint as Address;
const AUDITOR: Address = address("BxMVLbjVntF9DJtDjfpQLrgw4hopedMgNkZZKGcVkZp6");

function mintBytes(options: { confidential: boolean; auditor?: Address }) {
  return new Uint8Array(
    getMintEncoder().encode({
      mintAuthority: none(),
      supply: 0n,
      decimals: 6,
      isInitialized: true,
      freezeAuthority: none(),
      extensions: some(
        options.confidential
          ? [
              extension("ConfidentialTransferMint", {
                authority: null,
                autoApproveNewAccounts: true,
                auditorElgamalPubkey: options.auditor ?? null,
              }),
            ]
          : [extension("MetadataPointer", { authority: null, metadataAddress: null })],
      ),
    }),
  );
}

type Account = { owner: Address; executable: boolean; data: Uint8Array };

function fakeRpc(accounts: Map<string, Account>, v1 = true) {
  const encoded = (account: Account | undefined) =>
    account
      ? {
          data: [Buffer.from(account.data).toString("base64"), "base64"],
          executable: account.executable,
          lamports: 1_000_000n,
          owner: account.owner,
          space: BigInt(account.data.length),
          rentEpoch: 0n,
        }
      : null;
  const send = <T>(value: T) => ({ send: async () => value });
  const fail = () => ({
    send: async () => {
      throw new Error("Transaction version (1) is not supported");
    },
  });
  return {
    getMultipleAccounts: (addresses: string[]) =>
      send({ value: addresses.map((a) => encoded(accounts.get(a))) }),
    getAccountInfo: (a: string) => send({ value: encoded(accounts.get(a)) }),
    getLatestBlockhash: () => send({ value: { blockhash: "x", lastValidBlockHeight: 1n } }),
    getSlot: () => send(100n),
    getBlocks: () => send([98n, 99n]),
    getBlock: () => (v1 ? send({ blockhash: "x" }) : fail()),
  } as unknown as SolanaRpc;
}

async function world(mint: Account | null, programsExecutable = true) {
  const accounts = new Map<string, Account>();
  for (const program of [...Object.values(devnet.programs), devnet.sottoProofs?.program ?? ""]) {
    accounts.set(program, {
      owner: address("BPFLoaderUpgradeab1e11111111111111111111111"),
      executable: programsExecutable,
      data: new Uint8Array(36),
    });
  }
  const wrapped = await wrappedMintAddress(USDC, devnet.programs.tokenWrap);
  if (mint) accounts.set(wrapped, mint);
  return { accounts, wrapped };
}

describe("startup verification (06 section 0)", () => {
  it("passes with executable programs, the confidential wrapped mint without auditor and a v1 RPC", async () => {
    const { accounts, wrapped } = await world({
      owner: TOKEN_2022_PROGRAM_ADDRESS,
      executable: false,
      data: mintBytes({ confidential: true }),
    });
    // The configured devnet wrapped mint is the PDA of the Sotto Token Wrap deployment (facts C8, F1).
    expect(wrapped).toBe(devnet.wrappedUsdcMint);
    const check = await verifyCluster(fakeRpc(accounts), devnet);
    expect(check).toMatchObject({
      wrappedMint: { status: "ok", address: wrapped },
      v1: true,
      confidentialEnabled: true,
      transactionPath: "v1",
    });
    expect(check.programs.map((p) => p.name).sort()).toEqual([
      "sas",
      "sottoProofs",
      "token2022",
      "tokenWrap",
      "zkElGamalProof",
    ]);
  });

  it("disables confidential features for a missing program, a missing or wrong wrapped mint", async () => {
    const good = {
      owner: TOKEN_2022_PROGRAM_ADDRESS,
      executable: false,
      data: mintBytes({ confidential: true }),
    };
    const notExecutable = await world(good, false);
    expect((await verifyCluster(fakeRpc(notExecutable.accounts), devnet)).confidentialEnabled).toBe(
      false,
    );

    const missing = await world(null);
    expect((await verifyCluster(fakeRpc(missing.accounts), devnet)).wrappedMint).toEqual({
      status: "missing",
      address: missing.wrapped,
    });

    const audited = await world({
      ...good,
      data: mintBytes({ confidential: true, auditor: AUDITOR }),
    });
    expect((await verifyCluster(fakeRpc(audited.accounts), devnet)).wrappedMint).toMatchObject({
      status: "invalid",
      reason: "it has an auditor key",
    });

    const plain = await world({ ...good, data: mintBytes({ confidential: false }) });
    expect((await verifyCluster(fakeRpc(plain.accounts), devnet)).wrappedMint).toMatchObject({
      status: "invalid",
      reason: "it has no ConfidentialTransferMint extension",
    });

    const configured = await verifyCluster(fakeRpc(missing.accounts), devnet, {
      usdcMint: USDC,
      wrappedUsdcMint: AUDITOR,
    });
    expect(configured.wrappedMint).toMatchObject({ status: "mismatch", configured: AUDITOR });
    expect(
      (
        await verifyCluster(fakeRpc(missing.accounts), devnet, {
          usdcMint: null,
          wrappedUsdcMint: null,
        })
      ).wrappedMint,
    ).toEqual({ status: "not_configured" });
  });

  it("switches to the v0 path when the RPC refuses version 1 reads", async () => {
    const { accounts } = await world({
      owner: TOKEN_2022_PROGRAM_ADDRESS,
      executable: false,
      data: mintBytes({ confidential: true }),
    });
    const check = await verifyCluster(fakeRpc(accounts, false), devnet);
    expect(check).toMatchObject({ v1: false, transactionPath: "v0", confidentialEnabled: true });
  });
});
