// The faucet's devnet SOL on a local validator (step 4.6, D-31), with a fresh test database: a
// request is signed, stored as sent, then paid once it finalizes, and the wallet holds exactly the
// grant; running again sends nothing more. The job is told this ledger's genesis hash (main.ts never
// does: there it is devnet's only). Skipped unless SOTTO_LOCALNET_RPC_URL is set.
import { solGrants, users } from "@sotto/db";
import { createTestDatabase } from "@sotto/db/testing";
import { createRetryingRpc } from "@sotto/sdk/tx";
import { generateKeyPairSigner, lamports } from "@solana/kit";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { SOL_FAUCET_RESERVE_LAMPORTS, solFaucetJob } from "../src/jobs/sol-faucet.ts";

const RPC_URL = process.env.SOTTO_LOCALNET_RPC_URL;
const context = { signal: new AbortController().signal, log: () => {} };
const GRANT = 50_000_000n;

describe.skipIf(!RPC_URL)("sol-faucet job on localnet", () => {
  it(
    "sends a grant once, and the wallet holds exactly what was granted",
    { timeout: 180_000 },
    async () => {
      const database = await createTestDatabase();
      try {
        const rpc = createRetryingRpc(RPC_URL as string);
        const genesisHash = await rpc.getGenesisHash().send();
        const payer = await generateKeyPairSigner();
        const airdrop = await rpc.requestAirdrop(payer.address, lamports(1_000_000_000n)).send();
        for (let tries = 0; tries < 60; tries += 1) {
          const { value } = await rpc.getSignatureStatuses([airdrop]).send();
          if (value[0]?.confirmationStatus === "finalized") break;
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
        const wallet = (await generateKeyPairSigner()).address;
        const [user] = await database.db
          .insert(users)
          .values({ wallet })
          .returning({ id: users.id });
        if (!user) throw new Error("user not inserted");
        const [request] = await database.db
          .insert(solGrants)
          .values({ userId: user.id, wallet, lamports: GRANT })
          .returning();
        if (!request) throw new Error("grant not inserted");
        const row = async () =>
          (await database.db.select().from(solGrants).where(eq(solGrants.id, request.id)))[0];

        const job = solFaucetJob({ db: database.db, rpc, payer, genesisHash });
        expect(await job.run(context)).toEqual({ paid: 0, sent: 1, failed: 0 });
        expect((await row())?.status).toBe("sent");
        expect((await row())?.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);

        const deadline = Date.now() + 90_000;
        while ((await row())?.status !== "paid" && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          await job.run(context);
        }
        expect((await row())?.status).toBe("paid");
        expect(await job.run(context)).toEqual({ paid: 0, sent: 0, failed: 0 });
        expect((await rpc.getBalance(wallet, { commitment: "finalized" }).send()).value).toBe(
          GRANT,
        );

        // The reserve on a real ledger: a payer left with less than a grant above it sends nothing.
        const poor = await generateKeyPairSigner();
        const [second] = await database.db
          .insert(solGrants)
          .values({ userId: user.id, wallet: poor.address, lamports: GRANT })
          .returning();
        const low = solFaucetJob({ db: database.db, rpc, payer: poor, genesisHash });
        expect(await low.run(context)).toEqual({ paid: 0, sent: 0, failed: 1 });
        const [refused] = await database.db
          .select()
          .from(solGrants)
          .where(eq(solGrants.id, second?.id ?? ""));
        expect(refused).toMatchObject({ status: "failed", errorCode: "faucet_low" });
        expect(SOL_FAUCET_RESERVE_LAMPORTS).toBe(100_000_000n);
      } finally {
        await database.drop();
      }
    },
  );
});
