// sas-issue (08 section 4, F-02). After an admin approves an org, issue its sotto.business.v1
// attestation to the owner wallet (nonce = owner wallet, 365 day expiry) and store the attestation
// address (AC-02.3). After an admin suspends an org, close its attestation and clear the address
// (AC-02.4). Runs every 5 seconds over the orgs table. Every step is idempotent: a crash between
// the chain write and the database update is repaired on the next run, and an org suspended while
// its attestation was being issued gets it closed.
import { orgs, users, type Database } from "@sotto/db";
import { address, type Address } from "@solana/kit";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Job } from "./runner.ts";
import { attestationExpiry, LEVEL_AUTOMATIC, LEVEL_MANUAL_REVIEW } from "../sas/business-schema.ts";
import {
  closeAttestation,
  issueBusinessAttestation,
  loadBusinessSchema,
  readBusinessAttestation,
  sasAccountExists,
  type Ensured,
  type SasContext,
} from "../sas/client.ts";
import { deriveAttestationAddress, type SchemaAccount } from "../sas/sas-lib-boundary.ts";

export const SAS_ISSUE_INTERVAL_MS = 5_000;
const BATCH = 10;

export type SasIssueDeps = {
  db: Database;
  sas: SasContext;
  credential: Address;
  schemaAddress: Address;
  now?: () => Date;
};

const seconds = (date: Date) => BigInt(Math.floor(date.getTime() / 1000));

/**
 * The attestation's level: manual review when a Sotto admin decided (D-09, the decision carries the
 * admin's wallet), automatic when the org was verified with no admin, as on devnet (D-30).
 */
export function attestationLevel(org: { reviewedBy: string | null }): number {
  return org.reviewedBy ? LEVEL_MANUAL_REVIEW : LEVEL_AUTOMATIC;
}

export function sasIssueJob(deps: SasIssueDeps): Job {
  let schema: Ensured<SchemaAccount> | null = null;
  return {
    name: "sas-issue",
    intervalMs: SAS_ISSUE_INTERVAL_MS,
    run: async ({ log }) => {
      const toIssue = await deps.db
        .select({
          id: orgs.id,
          legalName: orgs.legalName,
          country: orgs.country,
          reviewedAt: orgs.reviewedAt,
          reviewedBy: orgs.reviewedBy,
          owner: users.wallet,
        })
        .from(orgs)
        .innerJoin(users, eq(users.id, orgs.ownerUserId))
        .where(and(eq(orgs.status, "active"), isNull(orgs.attestationAddress)))
        .limit(BATCH);
      const toClose = await deps.db
        .select({ id: orgs.id, attestation: orgs.attestationAddress })
        .from(orgs)
        .where(and(eq(orgs.status, "suspended"), isNotNull(orgs.attestationAddress)))
        .limit(BATCH);
      if (toIssue.length === 0 && toClose.length === 0) return { issued: 0, closed: 0 };

      schema ??= await loadBusinessSchema(deps.sas.rpc, deps.credential, deps.schemaAddress);
      let issued = 0;
      let closed = 0;
      for (const org of toIssue) {
        const owner = address(org.owner);
        const attestation = await deriveAttestationAddress(deps.credential, schema.address, owner);
        const existing = await readBusinessAttestation(deps.sas.rpc, attestation, schema.account);
        if (existing && existing.data.org_id !== org.id) {
          log("sas_issue_conflict", { orgId: org.id, attestation }, "error");
          continue;
        }
        if (!existing) {
          const now = deps.now?.() ?? new Date();
          await issueBusinessAttestation(deps.sas, {
            credential: deps.credential,
            schema,
            owner,
            data: {
              org_id: org.id,
              legal_name: org.legalName,
              country: org.country,
              verified_at: seconds(org.reviewedAt ?? now),
              level: attestationLevel(org),
            },
            expiry: attestationExpiry(seconds(now)),
          });
        }
        // Stored whatever the status is now: if the org was suspended meanwhile, the close step
        // below (on this or the next run) closes the attestation.
        const stored = await deps.db
          .update(orgs)
          .set({ attestationAddress: attestation })
          .where(and(eq(orgs.id, org.id), isNull(orgs.attestationAddress)))
          .returning({ id: orgs.id });
        if (stored.length > 0) {
          issued += 1;
          log("sas_attestation_issued", { orgId: org.id, attestation });
        }
      }
      for (const org of toClose) {
        if (!org.attestation) continue;
        const attestation = address(org.attestation);
        if (await sasAccountExists(deps.sas.rpc, attestation)) {
          await closeAttestation(deps.sas, { credential: deps.credential, attestation });
        }
        const cleared = await deps.db
          .update(orgs)
          .set({ attestationAddress: null })
          .where(
            and(
              eq(orgs.id, org.id),
              eq(orgs.status, "suspended"),
              eq(orgs.attestationAddress, attestation),
            ),
          )
          .returning({ id: orgs.id });
        if (cleared.length > 0) {
          closed += 1;
          log("sas_attestation_closed", { orgId: org.id, attestation });
        }
      }
      return { issued, closed };
    },
  };
}
