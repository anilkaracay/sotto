// The index-accounts job against the bootstrapped localnet (step 2.5, AC-05.3) with a fresh test
// database: an org owner's wUSDC account is set up, funded in one version 1 transaction, applied, pays a
// recipient with a version 0 and a version 1 transfer, withdraws and unwraps; one pass stores exactly
// the account's public activity (the instruction types in order, the recipient's account as the other
// account of each transfer, the deposit's and the withdrawal's amounts and no other), a second pass
// reads nothing new, and a later version 1 transfer is read by the next pass. The recipient's account,
// which the recipient recorded for the org, is not the org's and is not read. Skipped unless
// SOTTO_LOCALNET_RPC_URL is set; scripts/ci-local.sh runs it in the localnet job.
import { chainActivity, orgs, tokenAccounts, users } from "@sotto/db";
import { createTestDatabase, type TestDatabase } from "@sotto/db/testing";
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
} from "@sotto/sdk/testing/localnet";
import { createRetryingRpc, waitForConfirmation, type SolanaRpc } from "@sotto/sdk/tx";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { indexAccountsJob } from "../src/jobs/index-accounts.ts";

const RPC_URL = process.env.SOTTO_LOCALNET_RPC_URL;
const USDC = 1_000_000n;
const context = { signal: new AbortController().signal, log: () => {} };

describe.skipIf(!RPC_URL)("index-accounts job on localnet", () => {
  let database: TestDatabase;
  let rpc: SolanaRpc;
  let bootstrap: LocalnetBootstrap;
  let owner: LocalnetOwner;
  let recipient: LocalnetOwner;
  let orgId = "";

  const rowsOf = async (account: string) =>
    database.db
      .select()
      .from(chainActivity)
      .where(eq(chainActivity.tokenAccount, account))
      .orderBy(asc(chainActivity.slot), asc(chainActivity.instructionIndex));

  beforeAll(async () => {
    database = await createTestDatabase();
    rpc = createRetryingRpc(RPC_URL as string);
    bootstrap = readLocalnetBootstrap();
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

    const [ownerUser, recipientUser] = await database.db
      .insert(users)
      .values([{ wallet: owner.signer.address }, { wallet: recipient.signer.address }])
      .returning({ id: users.id });
    if (!ownerUser || !recipientUser) throw new Error("users not inserted");
    const [org] = await database.db
      .insert(orgs)
      .values({
        displayName: "Northwind",
        legalName: "Northwind Labs Ltd",
        country: "TR",
        registrationNo: "0001",
        website: "https://northwind.example",
        contactEmail: "ops@northwind.example",
        ownerUserId: ownerUser.id,
        status: "active",
      })
      .returning({ id: orgs.id });
    if (!org) throw new Error("org not inserted");
    orgId = org.id;
    await database.db.insert(tokenAccounts).values([
      {
        userId: ownerUser.id,
        orgId,
        cluster: "localnet",
        address: owner.wusdc,
        mint: bootstrap.wrappedUsdcMint,
        keyScheme: "standard_v1",
      },
      // The recipient's own account, recorded for the org: not the org's account.
      {
        userId: recipientUser.id,
        orgId,
        cluster: "localnet",
        address: recipient.wusdc,
        mint: bootstrap.wrappedUsdcMint,
        keyScheme: "standard_v1",
      },
    ]);
  }, 480_000);

  afterAll(async () => {
    await database?.drop();
  });

  it(
    "AC-05.3 stores the public activity of an org's account from version 0 and version 1 transactions, with only the public amounts, once",
    { timeout: 240_000 },
    async () => {
      const job = indexAccountsJob({ db: database.db, rpc });
      expect(await job.run(context)).toEqual({ accounts: 1, transactions: 7, rows: 8 });
      const rows = await rowsOf(owner.wusdc);
      expect(
        rows.map((row) => [
          row.instructionType,
          row.counterpartyAddress,
          row.publicAmountBaseUnits,
        ]),
      ).toEqual([
        ["account_setup", null, null],
        ["wrap", null, null],
        ["deposit", null, 20n * USDC],
        ["apply_pending", null, null],
        ["transfer_out", recipient.wusdc, null],
        ["transfer_out", recipient.wusdc, null],
        ["withdraw", null, 3_000_000n],
        ["unwrap", null, null],
      ]);
      expect(rows.every((row) => row.orgId === orgId && row.blockTime !== null)).toBe(true);
      expect(await rowsOf(recipient.wusdc)).toEqual([]);

      // Nothing new: the cursor holds.
      expect(await job.run(context)).toEqual({ accounts: 1, transactions: 0, rows: 0 });

      // A later version 1 transfer is read by the next pass.
      const later = await transferOnLocalnet(rpc, bootstrap, owner, recipient, 500_000n, 1);
      await waitForConfirmation(rpc, later, 120_000, "finalized");
      expect(await job.run(context)).toEqual({ accounts: 1, transactions: 1, rows: 1 });
      const [newest] = (await rowsOf(owner.wusdc)).slice(-1);
      expect(newest).toMatchObject({
        signature: later,
        instructionType: "transfer_out",
        counterpartyAddress: recipient.wusdc,
        publicAmountBaseUnits: null,
      });
      const [cursor] = await database.db
        .select({ until: tokenAccounts.indexedUntil })
        .from(tokenAccounts)
        .where(eq(tokenAccounts.address, owner.wusdc));
      expect(cursor?.until).toBe(later);
    },
  );
});
