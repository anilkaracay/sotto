// grant-expiry (08 section 4, 07 section 7, AC-10.4; step 2.4). Every hour, with no RPC call: a grant
// whose expiry passed while it was active or waiting for its viewer becomes expired, and its records
// are deleted in the same transaction, as a revoke does; each expiry is written to the access log
// (AC-10.5, metadata only). Between two runs the API already treats such a grant as expired: it
// stores nothing for it and returns none of its records.
import { disclosures, grants, insertAccessEvent, type Database } from "@sotto/db";
import { and, eq, inArray, lte } from "drizzle-orm";
import type { Job } from "./runner.ts";

export const GRANT_EXPIRY_INTERVAL_MS = 60 * 60 * 1000;
const BATCH = 100;

export type GrantExpiryDeps = { db: Database; now?: () => Date };

export function grantExpiryJob(deps: GrantExpiryDeps): Job {
  return {
    name: "grant-expiry",
    intervalMs: GRANT_EXPIRY_INTERVAL_MS,
    run: async () => {
      const now = deps.now?.() ?? new Date();
      const due = await deps.db
        .select({ id: grants.id })
        .from(grants)
        .where(
          and(inArray(grants.status, ["active", "pending_viewer_key"]), lte(grants.expiresAt, now)),
        )
        .limit(BATCH);
      let expired = 0;
      let deleted = 0;
      for (const { id } of due) {
        await deps.db.transaction(async (tx) => {
          const [grant] = await tx
            .update(grants)
            .set({ status: "expired" })
            .where(and(eq(grants.id, id), inArray(grants.status, ["active", "pending_viewer_key"])))
            .returning({ id: grants.id, orgId: grants.orgId, scope: grants.scope });
          if (!grant) return;
          const removed = await tx
            .delete(disclosures)
            .where(eq(disclosures.grantId, grant.id))
            .returning({ id: disclosures.id });
          await insertAccessEvent(tx, {
            orgId: grant.orgId,
            actorUserId: null,
            action: "grant_expired",
            subjectType: "grant",
            subjectId: grant.id,
            metadata: { deleted: removed.length, scope: grant.scope },
          });
          expired += 1;
          deleted += removed.length;
        });
      }
      return { expired, deleted };
    },
  };
}
