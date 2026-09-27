// The pending-credits job against the bootstrapped localnet (step 1.7, AC-04.3) with a fresh test
// database: an owner's wUSDC account configured with a credit counter maximum of 5 is flagged after 4
// deposits and cleared after the owner applies. Skipped unless SOTTO_LOCALNET_RPC_URL is set;
// scripts/ci-local.sh runs it in the localnet job after the bootstrap.
import { tokenAccounts, users } from "@sotto/db";
import { createTestDatabase } from "@sotto/db/testing";
import {
  applyLocalnetPending,
  localnetDeposit,
  newLocalnetOwner,
  readLocalnetBootstrap,
  sendAsOwner,
  setUpLocalnetAccount,
  wrapLocalnetUsdc,
} from "@sotto/sdk/testing/localnet";
import { createRetryingRpc } from "@sotto/sdk/tx";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { pendingCreditsJob } from "../src/jobs/pending-credits.ts";

const RPC_URL = process.env.SOTTO_LOCALNET_RPC_URL;
const context = { signal: new AbortController().signal, log: () => {} };

describe.skipIf(!RPC_URL)("pending-credits job on localnet", () => {
  it(
    "AC-04.3 flags an account at 80 percent of its credit counter, and clears it after the owner applies",
    { timeout: 180_000 },
    async () => {
      const database = await createTestDatabase();
      try {
        const rpc = createRetryingRpc(RPC_URL as string);
        const bootstrap = readLocalnetBootstrap();
        const owner = await newLocalnetOwner(rpc, bootstrap, 1n);
        await setUpLocalnetAccount(rpc, owner, bootstrap, 5n);
        await wrapLocalnetUsdc(rpc, owner, bootstrap, 1_000_000n);
        const [user] = await database.db
          .insert(users)
          .values({ wallet: owner.signer.address })
          .returning({ id: users.id });
        if (!user) throw new Error("user not inserted");
        await database.db.insert(tokenAccounts).values({
          userId: user.id,
          cluster: "localnet",
          address: owner.wusdc,
          mint: bootstrap.wrappedUsdcMint,
          keyScheme: "standard_v1",
        });
        const job = pendingCreditsJob({ db: database.db, rpc });
        const flagged = async () =>
          (
            await database.db
              .select({ at: tokenAccounts.applyFlaggedAt })
              .from(tokenAccounts)
              .where(eq(tokenAccounts.address, owner.wusdc))
          )[0]?.at ?? null;

        for (let credit = 1; credit <= 3; credit++) {
          await sendAsOwner(rpc, owner, [localnetDeposit(owner, bootstrap, 1n)]);
        }
        expect(await job.run(context)).toMatchObject({ cluster: "localnet", flagged: 0 });
        expect(await flagged()).toBeNull();

        await sendAsOwner(rpc, owner, [localnetDeposit(owner, bootstrap, 1n)]);
        expect(await job.run(context)).toMatchObject({ flagged: 1, cleared: 0 });
        expect(await flagged()).toBeInstanceOf(Date);

        await applyLocalnetPending(rpc, owner);
        expect(await job.run(context)).toMatchObject({ flagged: 0, cleared: 1 });
        expect(await flagged()).toBeNull();
      } finally {
        await database.drop();
      }
    },
  );
});
