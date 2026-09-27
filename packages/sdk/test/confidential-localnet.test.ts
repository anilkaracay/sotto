// The confidential account ACs on localnet (step 1.7 exit test), every transaction signed through the
// wallet path (a keypair behind the wallet signing interface, with the signed message check): the
// wrapped mint check and its permissionless creation (AC-03.1), account setup (AC-03.3), the balances
// after setup (AC-03.4), wrap and deposit in one transaction and apply (AC-04.1 to AC-04.3; step 1.7.1),
// a wrap and a deposit of public wUSDC on their own, each followed by balances read from chain (AC-04.4),
// and the 80 percent credit counter rule (AC-04.3). Needs the bootstrapped
// localnet (.localnet/bootstrap.json from scripts/bootstrap-localnet.ts). Skipped unless
// SOTTO_LOCALNET_RPC_URL is set; scripts/ci-local.sh runs it in the localnet job after the bootstrap.
import { getCreateAccountInstruction } from "@solana-program/system";
import {
  getInitializeMint2Instruction,
  getMintSize,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import { fetchToken } from "@solana-program/token-2022";
import {
  createNoopSigner,
  generateKeyPairSigner,
  setTransactionMessageComputeUnitPrice,
  type TransactionMessage,
} from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { getClusterConfig, type AvailableClusterConfig } from "../src/cluster/config.ts";
import { verifyCluster } from "../src/cluster/verify.ts";
import {
  accountSetupStatus,
  creditCounterNeedsApply,
  decryptTokenAccount,
  readPublicTokenBalance,
  readTokenAccountState,
} from "../src/confidential/index.ts";
import { keypairWallet } from "../src/testing/index.ts";
import {
  applyLocalnetPending,
  fundLocalnetAccount,
  localnetDeposit,
  newLocalnetOwner,
  readLocalnetBootstrap,
  sendAsOwner,
  setUpLocalnetAccount,
  wrapLocalnetUsdc,
  type LocalnetBootstrap,
  type LocalnetOwner,
} from "../src/testing/localnet.ts";
import {
  createRetryingRpc,
  sendWithKeypairSigners,
  sendWithWallet,
  WalletChangedTransactionError,
  type SolanaRpc,
} from "../src/tx/index.ts";
import { createWrappedMintInstructions, wrappedMintAddress } from "../src/wrap/index.ts";

const RPC_URL = process.env.SOTTO_LOCALNET_RPC_URL;
const USDC = 1_000_000n;

describe.skipIf(!RPC_URL)("confidential account setup and funding on localnet", () => {
  let rpc: SolanaRpc;
  let bootstrap: LocalnetBootstrap;
  let config: AvailableClusterConfig;
  let owner: LocalnetOwner;

  const send = (
    who: LocalnetOwner,
    instructions: Parameters<typeof sendAsOwner>[2],
    version: 0 | 1 = 0,
  ) => sendAsOwner(rpc, who, instructions, version);
  const deposit = (who: LocalnetOwner, amount: bigint) => localnetDeposit(who, bootstrap, amount);
  const setUp = (who: LocalnetOwner, maximum?: bigint) =>
    setUpLocalnetAccount(rpc, who, bootstrap, maximum);
  const wrap = async (who: LocalnetOwner, amount: bigint, version: 0 | 1 = 0) => {
    const { built, sent } = await wrapLocalnetUsdc(rpc, who, bootstrap, amount, version);
    expect(built.wrappedTokenAccount).toBe(who.wusdc);
    expect(built.escrow).toBe(bootstrap.escrow);
    return sent;
  };
  const apply = (who: LocalnetOwner) => applyLocalnetPending(rpc, who);

  /** Every balance of an owner, read from chain and decrypted with the owner's keys. */
  async function balances(who: LocalnetOwner) {
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

  beforeAll(async () => {
    rpc = createRetryingRpc(RPC_URL as string);
    bootstrap = readLocalnetBootstrap();
    config = getClusterConfig("localnet") as AvailableClusterConfig;
    owner = await newLocalnetOwner(rpc, bootstrap, 100n);
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
      const otherKey = (await newLocalnetOwner(rpc, bootstrap, 0n)).keys.elgamalPubkey;
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
    "AC-04.1 AC-04.2 AC-04.4 wraps and deposits in one transaction, and the balances come from chain",
    { timeout: 60_000 },
    async () => {
      const { plan, sent } = await fundLocalnetAccount(rpc, owner, bootstrap, 25n * USDC);
      expect(plan.split).toBeNull();
      expect(sent).toHaveLength(1);
      expect(await balances(owner)).toEqual({
        usdc: 75n * USDC,
        wusdc: 0n,
        pending: 25n * USDC,
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
        wusdc: 0n,
        pending: 0n,
        available: 25n * USDC,
        credits: 0n,
      });
    },
  );

  it(
    "AC-04.1 AC-04.2 AC-04.4 wraps alone and deposits public wUSDC on its own, as the recovery path does",
    { timeout: 60_000 },
    async () => {
      await wrap(owner, 10n * USDC, 1);
      expect(await balances(owner)).toMatchObject({ usdc: 65n * USDC, wusdc: 10n * USDC });
      await send(owner, [deposit(owner, 10n * USDC)], 1);
      expect(await balances(owner)).toEqual({
        usdc: 65n * USDC,
        wusdc: 0n,
        pending: 10n * USDC,
        available: 25n * USDC,
        credits: 1n,
      });
    },
  );

  it(
    "AC-04.3 counts credits toward the 80 percent flag, and apply clears it",
    { timeout: 180_000 },
    async () => {
      const small = await newLocalnetOwner(rpc, bootstrap, 1n);
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
      await wrap(owner, 2n * USDC);
      const sent = await sendWithWallet({
        rpc,
        wallet: budget,
        instructions: [deposit(owner, 1n * USDC)],
        version: 0,
      });
      expect(sent.comparison).toMatchObject({ kind: "compute_budget_only" });
      expect(await balances(owner)).toMatchObject({ wusdc: 1n * USDC, pending: 11n * USDC });

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
      expect(await balances(owner)).toMatchObject({ wusdc: 1n * USDC, pending: 11n * USDC });
    },
  );
});
