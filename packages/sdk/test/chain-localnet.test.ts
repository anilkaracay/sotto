// What the chain shows on localnet (step 2.5, 08 section 4, AC-05.3): an owner's wUSDC account is set
// up, funded (wrap and deposit in one version 1 transaction), applied, pays a recipient once with a
// version 0 transfer and once with a version 1 transfer, withdraws and unwraps; every finalized
// transaction of the account, read with getTransaction as base64 with maxSupportedTransactionVersion 1,
// gives exactly its public activity: the instruction types in order, the recipient's account as the
// other account of each transfer, and only the deposit's and the withdrawal's amounts. The recipient's
// account shows the two transfers in. getTransaction refuses a version 1 transaction without
// maxSupportedTransactionVersion (facts D2 tested only getBlock). Needs the bootstrapped localnet;
// skipped unless SOTTO_LOCALNET_RPC_URL is set (scripts/ci-local.sh runs it in the localnet job).
import { getBase64Encoder, type Address, type Signature } from "@solana/kit";
import { beforeAll, describe, expect, it } from "vitest";
import { activityOf, type ChainActivity } from "../src/chain/activity.ts";
import { getClusterConfig, type AvailableClusterConfig } from "../src/cluster/config.ts";
import {
  applyLocalnetPending,
  fundLocalnetAccount,
  newLocalnetOwner,
  readLocalnetBootstrap,
  setUpLocalnetAccount,
  transferOnLocalnet,
  withdrawAndUnwrapOnLocalnet,
  type LocalnetBootstrap,
  type LocalnetOwner,
} from "../src/testing/localnet.ts";
import { createRetryingRpc, waitForConfirmation, type SolanaRpc } from "../src/tx/index.ts";

const RPC_URL = process.env.SOTTO_LOCALNET_RPC_URL;
const USDC = 1_000_000n;

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
    await transferOnLocalnet(rpc, bootstrap, owner, recipient, 1_250_000n, 0);
    await transferOnLocalnet(rpc, bootstrap, owner, recipient, 1_250_000n, 1);
    const last = await withdrawAndUnwrapOnLocalnet(rpc, bootstrap, owner, 3_000_000n, 1);
    await waitForConfirmation(rpc, last, 120_000, "finalized");
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
