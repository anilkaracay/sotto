// The sas-issue job against SAS on localnet (the step 1.4 exit test, AC-02.3 and AC-02.4) with a
// fresh test database. Skipped unless SOTTO_LOCALNET_RPC_URL is set; scripts/ci-local.sh runs it in
// the localnet job. Uses a throwaway signer funded by airdrop.
import { orgs, users } from "@sotto/db";
import { createTestDatabase } from "@sotto/db/testing";
import { generateKeyPairSigner, lamports } from "@solana/kit";
import { createRetryingRpc, waitForConfirmation } from "@sotto/sdk/tx";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { sasIssueJob } from "../src/jobs/sas-issue.ts";
import {
  ensureBusinessSchema,
  ensureCredential,
  readBusinessAttestation,
  sasAccountExists,
} from "../src/sas/client.ts";
import { deriveAttestationAddress } from "../src/sas/sas-lib-boundary.ts";

const RPC_URL = process.env.SOTTO_LOCALNET_RPC_URL;
const context = { signal: new AbortController().signal, log: () => {} };

describe.skipIf(!RPC_URL)("sas-issue job on localnet", () => {
  it(
    "AC-02.3 issues the approved org's attestation to the owner wallet and stores its address; AC-02.4 closes it on suspension",
    { timeout: 180_000 },
    async () => {
      const database = await createTestDatabase();
      try {
        const rpc = createRetryingRpc(RPC_URL as string);
        const signer = await generateKeyPairSigner();
        await waitForConfirmation(
          rpc,
          await rpc.requestAirdrop(signer.address, lamports(2_000_000_000n)).send(),
        );
        const sas = { rpc, signer };
        const credential = await ensureCredential(sas);
        const schema = await ensureBusinessSchema(sas, credential.address);

        const reviewedAt = new Date("2026-09-25T10:00:00.000Z");
        const addOrg = async (legalName: string) => {
          const owner = (await generateKeyPairSigner()).address;
          const [user] = await database.db
            .insert(users)
            .values({ wallet: owner })
            .returning({ id: users.id });
          if (!user) throw new Error("user not inserted");
          const [org] = await database.db
            .insert(orgs)
            .values({
              displayName: legalName.slice(0, 80),
              legalName,
              country: "TR",
              registrationNo: "0001",
              website: "https://northwind.example",
              contactEmail: "ops@northwind.example",
              ownerUserId: user.id,
              status: "active",
              reviewedBy: signer.address,
              reviewedAt,
            })
            .returning({ id: orgs.id });
          if (!org) throw new Error("org not inserted");
          return { id: org.id, owner };
        };
        const org = await addOrg("Northwind Labs Ltd");
        const owner = org.owner;
        // The longest legal name the API accepts (200 characters and 400 bytes, LEGAL_NAME_MAX_BYTES
        // in apps/web/lib/org.ts, whose test points here) still fits the attestation transaction.
        const longName = "ş".repeat(200);
        expect(new TextEncoder().encode(longName).length).toBe(400);
        const longOrg = await addOrg(longName);

        const job = sasIssueJob({
          db: database.db,
          sas,
          credential: credential.address,
          schemaAddress: schema.address,
        });
        expect(await job.run(context)).toEqual({ issued: 2, closed: 0 });

        const expected = await deriveAttestationAddress(credential.address, schema.address, owner);
        const stored = async () =>
          (
            await database.db
              .select({ a: orgs.attestationAddress })
              .from(orgs)
              .where(eq(orgs.id, org.id))
          )[0]?.a;
        expect(await stored()).toBe(expected);
        const read = await readBusinessAttestation(rpc, expected, schema.account);
        expect(read?.account).toMatchObject({
          nonce: owner,
          signer: signer.address,
          credential: credential.address,
        });
        expect(read?.data).toEqual({
          org_id: org.id,
          legal_name: "Northwind Labs Ltd",
          country: "TR",
          verified_at: BigInt(reviewedAt.getTime() / 1000),
          level: 1,
        });
        const longRead = await readBusinessAttestation(
          rpc,
          await deriveAttestationAddress(credential.address, schema.address, longOrg.owner),
          schema.account,
        );
        expect(longRead?.data.legal_name).toBe(longName);
        const yearFromNow = BigInt(Math.floor(Date.now() / 1000)) + 365n * 24n * 3600n;
        const expiry = read?.account.expiry ?? 0n;
        expect(expiry > yearFromNow - 300n && expiry <= yearFromNow + 5n).toBe(true);

        // Idempotent: nothing left to do.
        expect(await job.run(context)).toEqual({ issued: 0, closed: 0 });

        await database.db.update(orgs).set({ status: "suspended" }).where(eq(orgs.id, org.id));
        expect(await job.run(context)).toEqual({ issued: 0, closed: 1 });
        expect(await sasAccountExists(rpc, expected)).toBe(false);
        expect(await stored()).toBeNull();
      } finally {
        await database.drop();
      }
    },
  );
});
