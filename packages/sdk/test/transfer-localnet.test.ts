// The confidential transfer on localnet (step 1.9, 06 section 5, AC-06.4, AC-06.5), every transaction
// through the wallet path (a keypair behind the wallet signing interface, with the signed message
// check) and the plan's own accounts co-signing: a version 0 transfer with the range proof staged in a
// record account and a version 1 transfer with it inline, each checked against chain (the sender's
// available balance down by the amount, the recipient's pending balance up by it, every proof account
// closed); a forced failure right before the transfer transaction (the recipient turns confidential
// credits off) that leaves both balances unchanged and closes the proof accounts it created; and the
// proof program check of F-19. Needs the bootstrapped localnet; skipped unless SOTTO_LOCALNET_RPC_URL
// is set (scripts/ci-local.sh runs it in the localnet job).
import {
  fetchMint,
  fetchToken,
  getDisableConfidentialCreditsInstruction,
  getEnableConfidentialCreditsInstruction,
} from "@solana-program/token-2022";
import {
  createNoopSigner,
  fetchEncodedAccounts,
  type Address,
  type KeyPairSigner,
  type SignatureBytes,
  type Transaction,
} from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import {
  checkProofProgram,
  closeProofAccounts,
  confidentialTransferPlan,
  confidentialWithdrawPlan,
  decryptTokenAccount,
  readPublicTokenBalance,
  sendTransferTransactions,
  TransferStepError,
  type ConfidentialTransferPlan,
} from "../src/confidential/index.ts";
import {
  applyLocalnetPending,
  fundLocalnetAccount,
  newLocalnetOwner,
  readLocalnetBootstrap,
  sendAsOwner,
  setUpLocalnetAccount,
  type LocalnetBootstrap,
  type LocalnetOwner,
} from "../src/testing/localnet.ts";
import { getClusterConfig, type AvailableClusterConfig } from "../src/cluster/config.ts";
import { createRetryingRpc, fromPortableInstruction, measureTransaction } from "../src/tx/index.ts";
import { unwrapInstructions } from "../src/wrap/index.ts";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import type { SolanaRpc } from "../src/tx/index.ts";

const RPC_URL = process.env.SOTTO_LOCALNET_RPC_URL;
const USDC = 1_000_000n;

/** The plan's accounts sign the transactions that need them, over the message the wallet signed. */
function cosigner(signers: readonly KeyPairSigner[]) {
  return async (transaction: Transaction): Promise<Record<Address, SignatureBytes>> => {
    const signatures: Record<Address, SignatureBytes> = {};
    for (const signer of signers) {
      if (!(signer.address in transaction.signatures)) continue;
      const [dictionary] = await signer.signTransactions([
        transaction as Parameters<KeyPairSigner["signTransactions"]>[0][number],
      ]);
      const signature = dictionary?.[signer.address];
      if (signature) signatures[signer.address] = signature;
    }
    return signatures;
  };
}

describe.skipIf(!RPC_URL)("confidential transfer on localnet", () => {
  let rpc: SolanaRpc;
  let bootstrap: LocalnetBootstrap;
  let sender: LocalnetOwner;
  let recipient: LocalnetOwner;

  async function decrypted(who: LocalnetOwner) {
    const token = await fetchToken(rpc, who.wusdc, { commitment: "confirmed" });
    return decryptTokenAccount(token.data, who.keys);
  }

  async function plan(amount: bigint, version: 0 | 1): Promise<ConfidentialTransferPlan> {
    const [source, destination, mint] = await Promise.all([
      fetchToken(rpc, sender.wusdc, { commitment: "confirmed" }),
      fetchToken(rpc, recipient.wusdc, { commitment: "confirmed" }),
      fetchMint(rpc, bootstrap.wrappedUsdcMint, { commitment: "confirmed" }),
    ]);
    return confidentialTransferPlan({
      owner: sender.signer.address,
      sourceToken: sender.wusdc,
      sourceTokenAccount: source.data,
      destinationToken: recipient.wusdc,
      destinationTokenAccount: destination.data,
      mint: bootstrap.wrappedUsdcMint,
      mintAccount: mint.data,
      amount,
      keys: sender.keys,
      version,
      rent: (space) => rpc.getMinimumBalanceForRentExemption(space).send(),
    });
  }

  /** The plan's transactions and their sizes, as the log records them. */
  function shape(built: ConfidentialTransferPlan, version: 0 | 1) {
    return built.transactions.map((transaction) => {
      const measure = measureTransaction({
        feePayer: sender.signer.address,
        instructions: transaction.instructions.map(fromPortableInstruction),
        version,
      });
      expect(measure.fits).toBe(true);
      return `${transaction.role}:${transaction.instructions.length}:${measure.size}/${measure.limit}`;
    });
  }

  async function allClosed(built: ConfidentialTransferPlan): Promise<boolean> {
    const targets = built.cleanup.map((instruction) => instruction.accounts[0]?.address as Address);
    const accounts = await fetchEncodedAccounts(rpc, targets, { commitment: "confirmed" });
    return accounts.every((account) => !account.exists);
  }

  beforeAll(async () => {
    rpc = createRetryingRpc(RPC_URL as string);
    bootstrap = readLocalnetBootstrap();
    sender = await newLocalnetOwner(rpc, bootstrap, 100n);
    recipient = await newLocalnetOwner(rpc, bootstrap, 0n);
    await setUpLocalnetAccount(rpc, sender, bootstrap);
    await setUpLocalnetAccount(rpc, recipient, bootstrap);
    await fundLocalnetAccount(rpc, sender, bootstrap, 60n * USDC);
    await applyLocalnetPending(rpc, sender);
  }, 180_000);

  it(
    "AC-06.4 sends a version 0 transfer with the range proof in a record account and closes every proof account",
    {
      timeout: 240_000,
    },
    async () => {
      const before = await decrypted(sender);
      expect(before.available).toBe(60n * USDC);
      const built = await plan(7_500_000n, 0);
      expect(built.variant).toBe("record");
      expect(built.availableBefore).toBe(60n * USDC);
      const layout = shape(built, 0);
      console.log(`v0 transfer plan: ${layout.length} transactions ${layout.join(" ")}`);
      expect(built.transactions.filter((t) => t.role === "transfer")).toHaveLength(1);
      const roles: string[] = [];
      const sent = await sendTransferTransactions({
        rpc,
        wallet: sender.wallet,
        version: 0,
        transactions: built.transactions,
        cosign: cosigner(built.signers),
        onStep: (_, role) => void roles.push(role),
      });
      expect(roles).toEqual(built.transactions.map((t) => t.role));
      expect(sent.signatures).toHaveLength(built.transactions.length);
      expect(sent.signatures).toContain(sent.transferSignature);
      const status = await rpc.getSignatureStatuses([sent.transferSignature as never]).send();
      expect(status.value[0]?.confirmationStatus).toBe("finalized");
      // 06 section 5 step 5: the new available balance is the previous one minus the amount.
      expect((await decrypted(sender)).available).toBe(before.available - 7_500_000n);
      expect((await decrypted(recipient)).pending).toBe(7_500_000n);
      expect(await allClosed(built)).toBe(true);
    },
  );

  it(
    "AC-06.4 sends a version 1 transfer with the range proof inline",
    {
      timeout: 240_000,
    },
    async () => {
      const before = await decrypted(sender);
      const recipientBefore = await decrypted(recipient);
      const built = await plan(2_500_000n, 1);
      expect(built.variant).toBe("inline");
      const layout = shape(built, 1);
      console.log(`v1 transfer plan: ${layout.length} transactions ${layout.join(" ")}`);
      await sendTransferTransactions({
        rpc,
        wallet: sender.wallet,
        version: 1,
        transactions: built.transactions,
        cosign: cosigner(built.signers),
      });
      expect((await decrypted(sender)).available).toBe(before.available - 2_500_000n);
      expect((await decrypted(recipient)).pending).toBe(recipientBefore.pending + 2_500_000n);
      expect(await allClosed(built)).toBe(true);
    },
  );

  it(
    "AC-06.5 names the failed step, closes the proof accounts it created, and leaves both balances unchanged",
    {
      timeout: 240_000,
    },
    async () => {
      const before = await decrypted(sender);
      const recipientBefore = await decrypted(recipient);
      const lamportsBefore = (await rpc.getBalance(sender.signer.address).send()).value;
      const built = await plan(1_000_000n, 0);
      const disableCredits = () =>
        sendAsOwner(rpc, recipient, [
          getDisableConfidentialCreditsInstruction({
            token: recipient.wusdc,
            authority: createNoopSigner(recipient.signer.address),
          }),
        ]);
      let failure: unknown;
      try {
        await sendTransferTransactions({
          rpc,
          wallet: sender.wallet,
          version: 0,
          transactions: built.transactions,
          cosign: cosigner(built.signers),
          // The recipient turns confidential credits off after the proofs landed.
          onStep: async (_, role) => {
            if (role === "transfer") await disableCredits();
          },
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(TransferStepError);
      const step = failure as TransferStepError;
      expect(step.role).toBe("transfer");
      expect(step.index).toBe(built.transactions.findIndex((t) => t.role === "transfer"));
      expect(await allClosed(built)).toBe(false);

      const closed = await closeProofAccounts({
        rpc,
        wallet: sender.wallet,
        version: 0,
        cleanup: built.cleanup,
        cosign: cosigner(built.signers),
      });
      expect(closed.closed.length).toBeGreaterThan(0);
      expect(await allClosed(built)).toBe(true);
      // Tokens are never lost: both balances are as before.
      expect((await decrypted(sender)).available).toBe(before.available);
      expect((await decrypted(recipient)).pending).toBe(recipientBefore.pending);
      // The rent of the proof accounts came back; only the network fees were spent.
      const lamportsAfter = (await rpc.getBalance(sender.signer.address).send()).value;
      const fees = lamportsBefore - lamportsAfter;
      expect(fees).toBeGreaterThan(0n);
      expect(fees).toBeLessThan(1_000_000n);

      await sendAsOwner(rpc, recipient, [
        getEnableConfidentialCreditsInstruction({
          token: recipient.wusdc,
          authority: createNoopSigner(recipient.signer.address),
        }),
      ]);
    },
  );

  for (const version of [0, 1] as const) {
    it(
      `AC-09.1 withdraws from the available balance to public wUSDC and unwraps it to USDC (version ${version})`,
      { timeout: 240_000 },
      async () => {
        const token = await fetchToken(rpc, sender.wusdc, { commitment: "confirmed" });
        const before = decryptTokenAccount(token.data, sender.keys);
        const publicBefore = token.data.amount;
        const usdc = async () => {
          const balance = await readPublicTokenBalance(rpc, sender.usdc);
          return balance.status === "present" ? balance.amount : 0n;
        };
        const usdcBefore = await usdc();
        const built = await confidentialWithdrawPlan({
          owner: sender.signer.address,
          token: sender.wusdc,
          tokenAccount: token.data,
          mint: bootstrap.wrappedUsdcMint,
          decimals: bootstrap.usdcDecimals,
          amount: 3_000_000n,
          keys: sender.keys,
          version,
          rent: (space) => rpc.getMinimumBalanceForRentExemption(space).send(),
        });
        expect(built.variant).toBe(version === 1 ? "inline" : "record");
        const layout = shape(built, version);
        console.log(`v${version} withdraw plan: ${layout.length} transactions ${layout.join(" ")}`);
        await sendTransferTransactions({
          rpc,
          wallet: sender.wallet,
          version,
          transactions: built.transactions,
          cosign: cosigner(built.signers),
        });
        expect(await allClosed(built)).toBe(true);
        const after = await fetchToken(rpc, sender.wusdc, { commitment: "confirmed" });
        expect(decryptTokenAccount(after.data, sender.keys).available).toBe(
          before.available - 3_000_000n,
        );
        expect(after.data.amount).toBe(publicBefore + 3_000_000n);

        // 06 section 6 step 3: the public wUSDC back to USDC through the cluster's Token Wrap.
        const localnet = getClusterConfig("localnet") as AvailableClusterConfig;
        const unwrap = await unwrapInstructions({
          owner: createNoopSigner(sender.signer.address),
          unwrappedMint: bootstrap.usdcMint,
          unwrappedTokenProgram: TOKEN_PROGRAM_ADDRESS,
          programAddress: localnet.programs.tokenWrap,
          amount: 3_000_000n,
        });
        expect(unwrap.wrappedTokenAccount).toBe(sender.wusdc);
        await sendAsOwner(rpc, sender, unwrap.instructions, version);
        const unwrapped = await fetchToken(rpc, sender.wusdc, { commitment: "confirmed" });
        expect(unwrapped.data.amount).toBe(publicBefore);
        expect(await usdc()).toBe(usdcBefore + 3_000_000n);
      },
    );
  }

  it("F-19 finds the proof program verifying proofs", { timeout: 60_000 }, async () => {
    expect(await checkProofProgram(rpc, sender.signer.address)).toEqual({ ok: true });
  });
});
