// The recipient-readiness job against the bootstrapped localnet (step 1.8, AC-07.2) with a fresh test
// database: a recipient whose wUSDC account is set up for confidential payments becomes ready, one
// without an account stays no_account, and one with a plain wUSDC account is not set up. Skipped
// unless SOTTO_LOCALNET_RPC_URL is set; scripts/ci-local.sh runs it in the localnet job.
import { orgs, recipients, users } from "@sotto/db";
import { createTestDatabase } from "@sotto/db/testing";
import {
  fundLocalnetWallet,
  newLocalnetOwner,
  readLocalnetBootstrap,
  setUpLocalnetAccount,
  wrapLocalnetUsdcAs,
} from "@sotto/sdk/testing/localnet";
import { createRetryingRpc } from "@sotto/sdk/tx";
import { generateKeyPairSigner } from "@solana/kit";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { recipientReadinessJob } from "../src/jobs/recipient-readiness.ts";

const RPC_URL = process.env.SOTTO_LOCALNET_RPC_URL;
const context = { signal: new AbortController().signal, log: () => {} };

describe.skipIf(!RPC_URL)("recipient-readiness job on localnet", () => {
  it(
    "AC-07.2 marks a recipient ready once its wUSDC account is set up, from chain state",
    { timeout: 180_000 },
    async () => {
      const database = await createTestDatabase();
      try {
        const rpc = createRetryingRpc(RPC_URL as string);
        const bootstrap = readLocalnetBootstrap();
        const configured = await newLocalnetOwner(rpc, bootstrap, 1n);
        await setUpLocalnetAccount(rpc, configured, bootstrap);
        const plain = await generateKeyPairSigner();
        await fundLocalnetWallet(rpc, bootstrap, plain.address, { sol: 2n, usdc: 1n });
        await wrapLocalnetUsdcAs(rpc, bootstrap, plain, 1_000_000n);
        const absent = (await generateKeyPairSigner()).address;

        const [owner] = await database.db
          .insert(users)
          .values({ wallet: (await generateKeyPairSigner()).address })
          .returning({ id: users.id });
        if (!owner) throw new Error("user not inserted");
        const [org] = await database.db
          .insert(orgs)
          .values({
            displayName: "Northwind",
            legalName: "Northwind Labs Ltd",
            country: "TR",
            registrationNo: "0001",
            website: "https://northwind.example",
            contactEmail: "ops@northwind.example",
            ownerUserId: owner.id,
            status: "active",
          })
          .returning({ id: orgs.id });
        if (!org) throw new Error("org not inserted");
        const wallets = {
          configured: configured.signer.address,
          plain: plain.address,
          absent,
        };
        for (const [name, wallet] of Object.entries(wallets)) {
          await database.db.insert(recipients).values({ orgId: org.id, displayName: name, wallet });
        }

        const job = recipientReadinessJob({
          db: database.db,
          rpc,
          localnetUsdcMint: bootstrap.usdcMint,
        });
        expect(await job.run(context)).toEqual({ checked: 3, ready: 1 });
        const readiness = async (wallet: string) =>
          (
            await database.db
              .select({ readiness: recipients.readiness })
              .from(recipients)
              .where(eq(recipients.wallet, wallet))
          )[0]?.readiness;
        expect(await readiness(wallets.configured)).toBe("ready");
        expect(await readiness(wallets.plain)).toBe("not_configured");
        expect(await readiness(wallets.absent)).toBe("no_account");
      } finally {
        await database.drop();
      }
    },
  );
});
