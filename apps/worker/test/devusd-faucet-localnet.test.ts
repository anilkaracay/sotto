// The devUSD faucet's mints on the bootstrapped localnet (step 4.3), with the ledger's devUSD mint
// authority and a fresh test database: a request is signed, stored as sent, then minted once it
// finalizes, into the wallet's associated devUSD account it creates; running again mints nothing more;
// a signer that is not the mint's authority mints nothing. The job is told this ledger's genesis hash
// (main.ts never does: there it is devnet's only). Skipped unless SOTTO_LOCALNET_RPC_URL is set.
import { readFileSync } from "node:fs";
import { faucetMints, orgs, users } from "@sotto/db";
import { createTestDatabase } from "@sotto/db/testing";
import { readLocalnetBootstrap } from "@sotto/sdk/testing/localnet";
import { createRetryingRpc } from "@sotto/sdk/tx";
import { fetchToken, findAssociatedTokenPda, TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";
import { createKeyPairSignerFromBytes, generateKeyPairSigner } from "@solana/kit";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { devusdFaucetJob } from "../src/jobs/devusd-faucet.ts";

const RPC_URL = process.env.SOTTO_LOCALNET_RPC_URL;
const context = { signal: new AbortController().signal, log: () => {} };

describe.skipIf(!RPC_URL)("devusd-faucet job on localnet", () => {
  it(
    "mints a request once, into the wallet's associated devUSD account",
    { timeout: 180_000 },
    async () => {
      const database = await createTestDatabase();
      try {
        const rpc = createRetryingRpc(RPC_URL as string);
        const bootstrap = readLocalnetBootstrap();
        if (!bootstrap.devusd) throw new Error("this ledger has no devUSD (bootstrap before 4.3)");
        const devusd = bootstrap.devusd;
        const authority = await createKeyPairSignerFromBytes(
          new Uint8Array(JSON.parse(readFileSync(devusd.mintAuthorityKeypair, "utf8")) as number[]),
        );
        const genesisHash = await rpc.getGenesisHash().send();
        const [owner] = await database.db
          .insert(users)
          .values({ wallet: (await generateKeyPairSigner()).address })
          .returning({ id: users.id });
        if (!owner) throw new Error("user not inserted");
        const [org] = await database.db
          .insert(orgs)
          .values({
            displayName: "Northwind",
            legalName: "Northwind Labs Demo Ltd",
            country: "GB",
            registrationNo: "0001",
            website: "https://northwind.example",
            contactEmail: "ops@northwind.example",
            ownerUserId: owner.id,
            status: "active",
            asset: "devusd",
          })
          .returning({ id: orgs.id });
        if (!org) throw new Error("org not inserted");

        // A signer that is not the mint's authority mints nothing.
        const [stray] = await database.db
          .insert(faucetMints)
          .values({ orgId: org.id, wallet: authority.address, amountBaseUnits: 1n })
          .returning();
        const impostor = devusdFaucetJob({
          db: database.db,
          rpc,
          authority: await generateKeyPairSigner(),
          mint: devusd.mint,
          genesisHash,
        });
        expect(await impostor.run(context)).toEqual({ minted: 0, sent: 0, failed: 1 });
        const [refused] = await database.db
          .select()
          .from(faucetMints)
          .where(eq(faucetMints.id, stray?.id ?? ""));
        expect(refused).toMatchObject({ status: "failed", errorCode: "wrong_authority" });

        const wallet = (await generateKeyPairSigner()).address;
        const [request] = await database.db
          .insert(faucetMints)
          .values({ orgId: org.id, wallet, amountBaseUnits: 10_000_000_000n })
          .returning();
        if (!request) throw new Error("request not inserted");
        const job = devusdFaucetJob({
          db: database.db,
          rpc,
          authority,
          mint: devusd.mint,
          genesisHash,
        });
        expect(await job.run(context)).toEqual({ minted: 0, sent: 1, failed: 0 });
        const [sent] = await database.db
          .select()
          .from(faucetMints)
          .where(eq(faucetMints.id, request.id));
        expect(sent?.status).toBe("sent");
        expect(sent?.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);

        const deadline = Date.now() + 90_000;
        let status = "sent";
        while (status !== "minted" && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          await job.run(context);
          const [row] = await database.db
            .select()
            .from(faucetMints)
            .where(eq(faucetMints.id, request.id));
          status = row?.status ?? "missing";
        }
        expect(status).toBe("minted");
        expect(await job.run(context)).toEqual({ minted: 0, sent: 0, failed: 0 });

        const [account] = await findAssociatedTokenPda({
          owner: wallet,
          mint: devusd.mint,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        });
        const token = await fetchToken(rpc, account, { commitment: "finalized" });
        expect(token.data.amount).toBe(10_000_000_000n);
      } finally {
        await database.drop();
      }
    },
  );
});
