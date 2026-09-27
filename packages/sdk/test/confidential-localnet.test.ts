// The confidential account ACs on localnet (step 1.7 exit test), every transaction signed through the
// wallet path (a keypair behind the wallet signing interface, with the signed message check): the
// wrapped mint check and its permissionless creation (AC-03.1), account setup (AC-03.3), the balances
// after setup (AC-03.4), wrap, deposit and apply (AC-04.1 to AC-04.3), each followed by balances read
// from chain (AC-04.4), and the 80 percent credit counter rule (AC-04.3). Needs the bootstrapped
// localnet (.localnet/bootstrap.json from scripts/bootstrap-localnet.ts). Skipped unless
// SOTTO_LOCALNET_RPC_URL is set; scripts/ci-local.sh runs it in the localnet job after the bootstrap.
import { readFileSync } from "node:fs";
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  getCreateAssociatedTokenIdempotentInstruction as getCreateSplAssociatedTokenInstruction,
  getInitializeMint2Instruction,
  getMintSize,
  getMintToInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { fetchToken } from "@solana-program/token-2022";
import {
  createKeyPairSignerFromBytes,
  createNoopSigner,
  generateKeyPairSigner,
  lamports,
  setTransactionMessageComputeUnitPrice,
  signBytes,
  type Address,
  type Instruction,
  type KeyPairSigner,
  type TransactionMessage,
  type TransactionModifyingSigner,
} from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { getClusterConfig, type AvailableClusterConfig } from "../src/cluster/config.ts";
import { verifyCluster } from "../src/cluster/verify.ts";
import {
  accountSetupStatus,
  applyPendingBalanceInstruction,
  associatedTokenAccount,
  confidentialAccountSetupInstructions,
  confidentialDepositInstruction,
  creditCounterNeedsApply,
  decryptTokenAccount,
  readPublicTokenBalance,
  readTokenAccountState,
} from "../src/confidential/index.ts";
import {
  confidentialKeysMessage,
  deriveStandardKeys,
  type ConfidentialKeyMaterial,
} from "../src/keys/index.ts";
import { keypairWallet } from "../src/testing/index.ts";
import {
  createRetryingRpc,
  sendWithKeypairSigners,
  sendWithWallet,
  waitForConfirmation,
  WalletChangedTransactionError,
  type SolanaRpc,
} from "../src/tx/index.ts";
import {
  createWrappedMintInstructions,
  wrappedMintAddress,
  wrapInstructions,
} from "../src/wrap/index.ts";

const RPC_URL = process.env.SOTTO_LOCALNET_RPC_URL;
const BOOTSTRAP = new URL("../../../.localnet/bootstrap.json", import.meta.url);
const USDC = 1_000_000n;

type Bootstrap = {
  payer: { address: Address; keypair: string };
  usdcMint: Address;
  usdcDecimals: number;
  wrappedUsdcMint: Address;
  escrow: Address;
};

type Owner = {
  signer: KeyPairSigner;
  wallet: TransactionModifyingSigner;
  keys: ConfidentialKeyMaterial;
  usdc: Address;
  wusdc: Address;
};

describe.skipIf(!RPC_URL)("confidential account setup and funding on localnet", () => {
  let rpc: SolanaRpc;
  let bootstrap: Bootstrap;
  let config: AvailableClusterConfig;
  let mintAuthority: KeyPairSigner;
  let owner: Owner;

  /** A new owner with SOL, `usdc` whole USDC and the standard_v1 keys of its wallet. */
  async function newOwner(usdc: bigint): Promise<Owner> {
    const signer = await generateKeyPairSigner();
    await waitForConfirmation(
      rpc,
      await rpc.requestAirdrop(signer.address, lamports(10_000_000_000n)).send(),
    );
    const signature = new Uint8Array(
      await signBytes(signer.keyPair.privateKey, confidentialKeysMessage()),
    );
    const keys = await deriveStandardKeys(signer.address, signature);
    const usdcAccount = await associatedTokenAccount(
      signer.address,
      bootstrap.usdcMint,
      TOKEN_PROGRAM_ADDRESS,
    );
    await sendWithKeypairSigners({
      rpc,
      feePayer: mintAuthority,
      instructions: [
        getCreateSplAssociatedTokenInstruction({
          payer: mintAuthority,
          ata: usdcAccount,
          owner: signer.address,
          mint: bootstrap.usdcMint,
        }),
        getMintToInstruction({
          mint: bootstrap.usdcMint,
          token: usdcAccount,
          mintAuthority,
          amount: usdc * USDC,
        }),
      ],
    });
    return {
      signer,
      wallet: keypairWallet(signer),
      keys,
      usdc: usdcAccount,
      wusdc: await associatedTokenAccount(signer.address, bootstrap.wrappedUsdcMint),
    };
  }

  const send = (who: Owner, instructions: readonly Instruction[], version: 0 | 1 = 0) =>
    sendWithWallet({ rpc, wallet: who.wallet, instructions, version });

  /** Every balance of an owner, read from chain and decrypted with the owner's keys. */
  async function balances(who: Owner) {
    const [usdc, wusdc, token] = await Promise.all([
      readPublicTokenBalance(rpc, who.usdc),
      readPublicTokenBalance(rpc, who.wusdc),
      fetchToken(rpc, who.wusdc, { commitment: "confirmed" }),
    ]);
    const decrypted = decryptTokenAccount(token.data, who.keys);
    return {
      usdc: usdc.status === "present" ? usdc.amount : null,
      wusdc: wusdc.status === "present" ? wusdc.amount : null,
      pending: decrypted.pending,
      available: decrypted.available,
      credits: decrypted.pendingBalanceCreditCounter,
    };
  }

  async function setUp(who: Owner, maximumPendingBalanceCreditCounter?: bigint) {
    const setup = await confidentialAccountSetupInstructions({
      owner: createNoopSigner(who.signer.address),
      mint: bootstrap.wrappedUsdcMint,
      keys: who.keys,
      ...(maximumPendingBalanceCreditCounter === undefined
        ? {}
        : { maximumPendingBalanceCreditCounter }),
    });
    expect(setup.token).toBe(who.wusdc);
    return send(who, setup.instructions, 1);
  }

  async function wrap(who: Owner, amount: bigint, version: 0 | 1 = 0) {
    const built = await wrapInstructions({
      owner: createNoopSigner(who.signer.address),
      unwrappedMint: bootstrap.usdcMint,
      unwrappedTokenProgram: TOKEN_PROGRAM_ADDRESS,
      programAddress: config.programs.tokenWrap,
      amount,
    });
    expect(built.wrappedTokenAccount).toBe(who.wusdc);
    expect(built.escrow).toBe(bootstrap.escrow);
    return send(who, built.instructions, version);
  }

  const deposit = (who: Owner, amount: bigint) =>
    confidentialDepositInstruction({
      token: who.wusdc,
      mint: bootstrap.wrappedUsdcMint,
      owner: createNoopSigner(who.signer.address),
      amount,
      decimals: bootstrap.usdcDecimals,
    });

  async function apply(who: Owner) {
    const fresh = await fetchToken(rpc, who.wusdc, { commitment: "confirmed" });
    return send(who, [
      applyPendingBalanceInstruction({
        token: who.wusdc,
        tokenAccount: fresh.data,
        owner: createNoopSigner(who.signer.address),
        keys: who.keys,
      }),
    ]);
  }

  beforeAll(async () => {
    rpc = createRetryingRpc(RPC_URL as string);
    bootstrap = JSON.parse(readFileSync(BOOTSTRAP, "utf8")) as Bootstrap;
    config = getClusterConfig("localnet") as AvailableClusterConfig;
    mintAuthority = await createKeyPairSignerFromBytes(
      new Uint8Array(JSON.parse(readFileSync(bootstrap.payer.keypair, "utf8")) as number[]),
    );
    owner = await newOwner(100n);
  }, 120_000);

  it(
    "AC-03.1 finds the wrapped USDC mint, and the owner creates a missing one permissionless",
    { timeout: 120_000 },
    async () => {
      const found = await verifyCluster(rpc, config, {
        usdcMint: bootstrap.usdcMint,
        wrappedUsdcMint: bootstrap.wrappedUsdcMint,
      });
      expect(found.wrappedMint).toEqual({ status: "ok", address: bootstrap.wrappedUsdcMint });

      // A USDC-like mint nobody wrapped yet: the check reports it missing at the derived address.
      const mint = await generateKeyPairSigner();
      const space = getMintSize();
      await sendWithKeypairSigners({
        rpc,
        feePayer: owner.signer,
        instructions: [
          getCreateAccountInstruction({
            payer: owner.signer,
            newAccount: mint,
            lamports: await rpc.getMinimumBalanceForRentExemption(BigInt(space)).send(),
            space,
            programAddress: TOKEN_PROGRAM_ADDRESS,
          }),
          getInitializeMint2Instruction({
            mint: mint.address,
            decimals: 6,
            mintAuthority: owner.signer.address,
          }),
        ],
      });
      const derived = await wrappedMintAddress(mint.address, config.programs.tokenWrap);
      const mints = { usdcMint: mint.address, wrappedUsdcMint: null };
      expect((await verifyCluster(rpc, config, mints)).wrappedMint).toEqual({
        status: "missing",
        address: derived,
      });

      const created = await createWrappedMintInstructions({
        rpc,
        payer: createNoopSigner(owner.signer.address),
        unwrappedMint: mint.address,
        programAddress: config.programs.tokenWrap,
      });
      expect(created.wrappedMint).toBe(derived);
      await send(owner, created.instructions);
      expect((await verifyCluster(rpc, config, mints)).wrappedMint).toEqual({
        status: "ok",
        address: derived,
      });
    },
  );

  it(
    "AC-03.3 creates and configures the owner's wUSDC account, signed by the owner, and setup is idempotent",
    { timeout: 120_000 },
    async () => {
      const expected = {
        owner: owner.signer.address,
        mint: bootstrap.wrappedUsdcMint,
        elgamalPubkey: owner.keys.elgamalPubkey,
      };
      expect(accountSetupStatus(await readTokenAccountState(rpc, owner.wusdc), expected)).toEqual({
        kind: "needs_setup",
        created: false,
      });
      const sent = await setUp(owner);
      expect(sent.comparison).toEqual({ kind: "identical" });
      expect(sent.version).toBe(1);

      const state = await readTokenAccountState(rpc, owner.wusdc);
      expect(state).toMatchObject({
        status: "present",
        owner: owner.signer.address,
        mint: bootstrap.wrappedUsdcMint,
        confidential: {
          elgamalPubkey: owner.keys.elgamalPubkey,
          approved: true,
          allowConfidentialCredits: true,
          pendingBalanceCreditCounter: 0n,
        },
      });
      // Idempotent: a configured account needs nothing more, and another key stops setup.
      expect(accountSetupStatus(state, expected)).toMatchObject({ kind: "configured" });
      const otherKey = (await newOwner(0n)).keys.elgamalPubkey;
      expect(accountSetupStatus(state, { ...expected, elgamalPubkey: otherKey })).toEqual({
        kind: "other_key",
        onchain: owner.keys.elgamalPubkey,
      });
    },
  );

  it("AC-03.4 reads the public, pending and available balances after setup", async () => {
    expect(await balances(owner)).toEqual({
      usdc: 100n * USDC,
      wusdc: 0n,
      pending: 0n,
      available: 0n,
      credits: 0n,
    });
  });

  it(
    "AC-04.1 AC-04.4 wraps USDC into public wUSDC, and both balances come from chain",
    { timeout: 60_000 },
    async () => {
      await wrap(owner, 25n * USDC);
      expect(await balances(owner)).toMatchObject({ usdc: 75n * USDC, wusdc: 25n * USDC });
    },
  );

  it(
    "AC-04.2 AC-04.4 deposits public wUSDC into the pending balance",
    { timeout: 60_000 },
    async () => {
      await send(owner, [deposit(owner, 10n * USDC)], 1);
      expect(await balances(owner)).toEqual({
        usdc: 75n * USDC,
        wusdc: 15n * USDC,
        pending: 10n * USDC,
        available: 0n,
        credits: 1n,
      });
    },
  );

  it(
    "AC-04.3 AC-04.4 applies the pending balance into the available balance from fresh state",
    { timeout: 60_000 },
    async () => {
      await apply(owner);
      expect(await balances(owner)).toEqual({
        usdc: 75n * USDC,
        wusdc: 15n * USDC,
        pending: 0n,
        available: 10n * USDC,
        credits: 0n,
      });
    },
  );

  it(
    "AC-04.3 counts credits toward the 80 percent flag, and apply clears it",
    { timeout: 180_000 },
    async () => {
      const small = await newOwner(1n);
      await setUp(small, 5n);
      await wrap(small, 1n * USDC, 1);
      const flagged = async () => {
        const state = await readTokenAccountState(rpc, small.wusdc);
        if (state.status !== "present" || !state.confidential) throw new Error("not configured");
        return creditCounterNeedsApply(state.confidential);
      };
      for (let credit = 1; credit <= 4; credit++) {
        await send(small, [deposit(small, 1n)]);
        expect(await flagged(), `after ${credit} credits of 5`).toBe(credit >= 4);
      }
      await apply(small);
      expect(await flagged()).toBe(false);
      expect(await balances(small)).toMatchObject({ pending: 0n, available: 4n, credits: 0n });
    },
  );

  it(
    "sends through a wallet that changed only the compute budget, and refuses one that changed an instruction",
    { timeout: 60_000 },
    async () => {
      const budget = keypairWallet(owner.signer, (message) =>
        setTransactionMessageComputeUnitPrice(
          123n,
          message as Extract<TransactionMessage, { version: 0 }>,
        ),
      );
      const sent = await sendWithWallet({
        rpc,
        wallet: budget,
        instructions: [deposit(owner, 1n * USDC)],
        version: 0,
      });
      expect(sent.comparison).toMatchObject({ kind: "compute_budget_only" });
      expect(await balances(owner)).toMatchObject({ wusdc: 14n * USDC, pending: 1n * USDC });

      const tampering = keypairWallet(owner.signer, (message) => ({
        ...message,
        instructions: message.instructions.map((instruction, index) =>
          index === 0 && instruction.data
            ? { ...instruction, data: new Uint8Array([...instruction.data].fill(0, 2, 10)) }
            : instruction,
        ),
      }));
      await expect(
        sendWithWallet({
          rpc,
          wallet: tampering,
          instructions: [deposit(owner, 1n * USDC)],
          version: 0,
        }),
      ).rejects.toBeInstanceOf(WalletChangedTransactionError);
      expect(await balances(owner)).toMatchObject({ wusdc: 14n * USDC, pending: 1n * USDC });
    },
  );
});
