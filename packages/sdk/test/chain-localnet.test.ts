// What the chain shows on localnet (step 2.5, 08 section 4, AC-05.3): an owner's wUSDC account is set
// up, funded (wrap and deposit in one version 1 transaction), applied, pays a recipient once with a
// version 0 transfer and once with a version 1 transfer, withdraws and unwraps; every finalized
// transaction of the account, read with getTransaction as base64 with maxSupportedTransactionVersion 1,
// gives exactly its public activity: the instruction types in order, the recipient's account as the
// other account of each transfer, and only the deposit's and the withdrawal's amounts. The recipient's
// account shows the two transfers in. getTransaction refuses a version 1 transaction without
// maxSupportedTransactionVersion (facts D2 tested only getBlock). Needs the bootstrapped localnet;
// skipped unless SOTTO_LOCALNET_RPC_URL is set (scripts/ci-local.sh runs it in the localnet job).
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { fetchMint, fetchToken } from "@solana-program/token-2022";
import {
  createNoopSigner,
  getBase64Encoder,
  type Address,
  type KeyPairSigner,
  type Signature,
  type SignatureBytes,
  type Transaction,
} from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { activityOf, type ChainActivity } from "../src/chain/activity.ts";
import { getClusterConfig, type AvailableClusterConfig } from "../src/cluster/config.ts";
import {
  confidentialTransferPlan,
  confidentialWithdrawPlan,
  sendTransferTransactions,
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
import { createRetryingRpc, waitForConfirmation, type SolanaRpc } from "../src/tx/index.ts";
import { unwrapInstructions } from "../src/wrap/index.ts";

const RPC_URL = process.env.SOTTO_LOCALNET_RPC_URL;
const USDC = 1_000_000n;

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

describe.skipIf(!RPC_URL)("what the chain shows on localnet", () => {
  let rpc: SolanaRpc;
  let bootstrap: LocalnetBootstrap;
  let tokenWrap: Address;
  let owner: LocalnetOwner;
  let recipient: LocalnetOwner;
  const versions = new Map<string, number | string>();

  /** The account's finalized history, oldest first, each transaction's activity. */
  async function history(account: Address) {
    const listed = await rpc
      .getSignaturesForAddress(account, { commitment: "finalized", limit: 1000 })
      .send();
    const read: { signature: string; activity: ChainActivity[] }[] = [];
    for (const entry of [...listed].reverse()) {
      if (entry.err !== null) continue;
      const found = await rpc
        .getTransaction(entry.signature, {
          encoding: "base64",
          maxSupportedTransactionVersion: 1,
          commitment: "finalized",
        })
        .send();
      if (!found) throw new Error(`transaction ${entry.signature} not found`);
      versions.set(entry.signature, found.version);
      const result = activityOf({
        wire: new Uint8Array(getBase64Encoder().encode(found.transaction[0])),
        account,
        tokenWrapProgram: tokenWrap,
      });
      if (result.kind !== "read") throw new Error("a Sotto transaction uses no lookup table");
      read.push({ signature: entry.signature, activity: result.activity });
    }
    return read;
  }

  beforeAll(async () => {
    rpc = createRetryingRpc(RPC_URL as string);
    bootstrap = readLocalnetBootstrap();
    tokenWrap = (getClusterConfig("localnet") as AvailableClusterConfig).programs.tokenWrap;
    owner = await newLocalnetOwner(rpc, bootstrap, 100n);
    recipient = await newLocalnetOwner(rpc, bootstrap, 0n);
    await setUpLocalnetAccount(rpc, owner, bootstrap);
    await setUpLocalnetAccount(rpc, recipient, bootstrap);
    await fundLocalnetAccount(rpc, owner, bootstrap, 20n * USDC, 1);
    await applyLocalnetPending(rpc, owner);
    for (const version of [0, 1] as const) {
      const [source, destination, mint] = await Promise.all([
        fetchToken(rpc, owner.wusdc, { commitment: "confirmed" }),
        fetchToken(rpc, recipient.wusdc, { commitment: "confirmed" }),
        fetchMint(rpc, bootstrap.wrappedUsdcMint, { commitment: "confirmed" }),
      ]);
      const plan = await confidentialTransferPlan({
        owner: owner.signer.address,
        sourceToken: owner.wusdc,
        sourceTokenAccount: source.data,
        destinationToken: recipient.wusdc,
        destinationTokenAccount: destination.data,
        mint: bootstrap.wrappedUsdcMint,
        mintAccount: mint.data,
        amount: 1_250_000n,
        keys: owner.keys,
        version,
        rent: (space) => rpc.getMinimumBalanceForRentExemption(space).send(),
      });
      await sendTransferTransactions({
        rpc,
        wallet: owner.wallet,
        version,
        transactions: plan.transactions,
        cosign: cosigner(plan.signers),
      });
    }
    const token = await fetchToken(rpc, owner.wusdc, { commitment: "confirmed" });
    const withdraw = await confidentialWithdrawPlan({
      owner: owner.signer.address,
      token: owner.wusdc,
      tokenAccount: token.data,
      mint: bootstrap.wrappedUsdcMint,
      decimals: bootstrap.usdcDecimals,
      amount: 3_000_000n,
      keys: owner.keys,
      version: 1,
      rent: (space) => rpc.getMinimumBalanceForRentExemption(space).send(),
    });
    await sendTransferTransactions({
      rpc,
      wallet: owner.wallet,
      version: 1,
      transactions: withdraw.transactions,
      cosign: cosigner(withdraw.signers),
    });
    const unwrap = await unwrapInstructions({
      owner: createNoopSigner(owner.signer.address),
      unwrappedMint: bootstrap.usdcMint,
      unwrappedTokenProgram: TOKEN_PROGRAM_ADDRESS,
      programAddress: tokenWrap,
      amount: 3_000_000n,
    });
    const last = await sendAsOwner(rpc, owner, unwrap.instructions, 1);
    await waitForConfirmation(rpc, last.signature, 120_000, "finalized");
  }, 420_000);

  it(
    "AC-05.3 reads every finalized transaction of the account, version 0 and version 1, as public activity only",
    { timeout: 240_000 },
    async () => {
      const read = await history(owner.wusdc);
      const rows = read.flatMap((entry) =>
        entry.activity.map((activity) => [
          activity.type,
          activity.counterparty,
          activity.publicAmount,
        ]),
      );
      expect(rows).toEqual([
        ["account_setup", null, null],
        ["wrap", null, null],
        ["deposit", null, 20n * USDC],
        ["apply_pending", null, null],
        ["transfer_out", recipient.wusdc, null],
        ["transfer_out", recipient.wusdc, null],
        ["withdraw", null, 3_000_000n],
        ["unwrap", null, null],
      ]);
      // Both transfers are read: the version 0 plan's transfer transaction and the version 1 one.
      const transfers = read.filter((entry) =>
        entry.activity.some((activity) => activity.type === "transfer_out"),
      );
      expect(transfers.map((entry) => versions.get(entry.signature))).toEqual([0, 1]);
      // The recipient's account: the two transfers in, from the owner's account.
      const received = (await history(recipient.wusdc)).flatMap((entry) =>
        entry.activity.filter((activity) => activity.type === "transfer_in"),
      );
      expect(received.map((activity) => activity.counterparty)).toEqual([owner.wusdc, owner.wusdc]);
      // Facts D2 for getTransaction: a version 1 transaction needs maxSupportedTransactionVersion 1.
      const v1 = transfers[1]?.signature as Signature;
      await expect(
        rpc.getTransaction(v1, { encoding: "base64", commitment: "finalized" }).send(),
      ).rejects.toThrow(/version/i);
    },
  );
});
