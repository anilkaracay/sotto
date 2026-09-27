// The attestation close on localnet (step 1.6 exit test): the close path against the SAS program
// cloned from devnet, and the command's refusal of localnet's genesis hash. Skipped unless
// SOTTO_LOCALNET_RPC_URL is set; scripts/ci-local.sh runs it in the localnet job.
import { spawnSync } from "node:child_process";
import { cpSync, copyFileSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateKeyPairSigner, lamports } from "@solana/kit";
import { createRetryingRpc, waitForConfirmation } from "@sotto/sdk/tx";
import { describe, expect, it } from "vitest";
import { attestationExpiry, LEVEL_MANUAL_REVIEW } from "../src/sas/business-schema.ts";
import {
  ensureBusinessSchema,
  ensureCredential,
  issueBusinessAttestation,
  sasAccountExists,
} from "../src/sas/client.ts";
import { closeOwnerAttestation } from "../src/sas/close.ts";

const RPC_URL = process.env.SOTTO_LOCALNET_RPC_URL;
const WORKER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

describe.skipIf(!RPC_URL)("attestation close on localnet", () => {
  it(
    "closes an owner's attestation once and then finds nothing to close",
    { timeout: 180_000 },
    async () => {
      const rpc = createRetryingRpc(RPC_URL as string);
      const signer = await generateKeyPairSigner();
      await waitForConfirmation(
        rpc,
        await rpc.requestAirdrop(signer.address, lamports(2_000_000_000n)).send(),
      );
      const ctx = { rpc, signer };
      const credential = await ensureCredential(ctx);
      const schema = await ensureBusinessSchema(ctx, credential.address);
      const owner = (await generateKeyPairSigner()).address;
      const issued = await issueBusinessAttestation(ctx, {
        credential: credential.address,
        schema,
        owner,
        data: {
          org_id: "00000000-0000-4000-8000-000000000000",
          legal_name: "Close Test Ltd",
          country: "DE",
          verified_at: 1n,
          level: LEVEL_MANUAL_REVIEW,
        },
        expiry: attestationExpiry(BigInt(Math.floor(Date.now() / 1000))),
      });
      const input = { credential: credential.address, schema: schema.address, owner };
      const closed = await closeOwnerAttestation(ctx, input);
      expect(closed.attestation).toBe(issued.address);
      expect(closed.signature).not.toBeNull();
      expect(await sasAccountExists(rpc, issued.address)).toBe(false);
      expect(await closeOwnerAttestation(ctx, input)).toEqual({
        attestation: issued.address,
        signature: null,
      });
    },
  );

  it("the command refuses localnet before it reads or sends anything", () => {
    // A copy without .env.local, so the process environment points the command at localnet.
    const dir = mkdtempSync(join(tmpdir(), "sotto-sas-close-"));
    try {
      cpSync(join(WORKER_DIR, "src"), join(dir, "src"), { recursive: true });
      copyFileSync(join(WORKER_DIR, "package.json"), join(dir, "package.json"));
      symlinkSync(join(WORKER_DIR, "node_modules"), join(dir, "node_modules"), "dir");
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const seed = Buffer.from(privateKey.export({ format: "jwk" }).d as string, "base64url");
      const pub = Buffer.from(publicKey.export({ format: "jwk" }).x as string, "base64url");
      const keypair = join(dir, "signer.json");
      writeFileSync(keypair, JSON.stringify([...seed, ...pub]));
      const run = spawnSync(
        process.execPath,
        [
          join(dir, "src", "bin", "sas-close-attestation.ts"),
          "--owner",
          "6xosZg2PbZuneXX4riov7GmUCJmydQc3o5MGX6p5EU2",
        ],
        {
          env: {
            PATH: process.env.PATH ?? "",
            RPC_URL: RPC_URL as string,
            SAS_SIGNER_KEYPAIR: keypair,
            SAS_CREDENTIAL_ADDRESS: "4KX4P7he62x5x8X35vubNNhJRhV4vJXPGNsc8skPyKFT",
            SAS_SCHEMA_ADDRESS: "A4PX8yuPQYeZFqtPomd5E3Jce7dTuWktcnpzb9YCM4z3",
          },
          encoding: "utf8",
          timeout: 60_000,
        },
      );
      expect(run.status).toBe(1);
      expect(run.stderr).toContain("does not serve devnet");
      expect(run.stdout).not.toContain("attestation:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
