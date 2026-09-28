// The proof-program-health job against the bootstrapped localnet (step 1.9, F-19): the simulated
// VerifyPubkeyValidity succeeds, so the job stores a success for localnet. The fee payer is the
// bootstrap's funded SAS signer, as the worker's own signer would be. Skipped unless
// SOTTO_LOCALNET_RPC_URL is set; scripts/ci-local.sh runs it in the localnet job.
import { clusterHealth } from "@sotto/db";
import { createTestDatabase } from "@sotto/db/testing";
import { readLocalnetBootstrap } from "@sotto/sdk/testing/localnet";
import { createRetryingRpc } from "@sotto/sdk/tx";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { proofProgramHealthJob } from "../src/jobs/proof-program-health.ts";

const RPC_URL = process.env.SOTTO_LOCALNET_RPC_URL;
const context = { signal: new AbortController().signal, log: () => {} };

describe.skipIf(!RPC_URL)("proof-program-health job on localnet", () => {
  it(
    "F-19 finds the ZK ElGamal Proof program verifying a proof",
    { timeout: 120_000 },
    async () => {
      const database = await createTestDatabase();
      try {
        const bootstrap = readLocalnetBootstrap();
        const job = proofProgramHealthJob({
          db: database.db,
          rpc: createRetryingRpc(RPC_URL as string),
          feePayer: bootstrap.sas.signer,
        });
        expect(await job.run(context)).toEqual({ checked: true, cluster: "localnet", ok: true });
        const [stored] = await database.db
          .select()
          .from(clusterHealth)
          .where(eq(clusterHealth.cluster, "localnet"));
        expect(stored).toMatchObject({ proofProgramOk: true, detail: null });
      } finally {
        await database.drop();
      }
    },
  );
});
