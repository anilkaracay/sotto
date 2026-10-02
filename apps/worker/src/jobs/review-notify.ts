// review-notify (step 4.2, founder 2026-10-02): every minute, each organization that entered review
// and has not been announced yet is announced once to SOTTO_NOTIFY_URL (notify.ts). Without the
// variable the job only counts the waiting organizations and marks nothing, so they are announced
// once it is set; it never fails the worker. A message the service refused (4xx) is not tried
// again; a network error or a 5xx is tried at the next run.
import { orgs, type Database } from "@sotto/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { reviewMessage, sendNotification, type NotifyTarget } from "../notify.ts";
import type { Job } from "./runner.ts";

export const REVIEW_NOTIFY_INTERVAL_MS = 60 * 1000;
const BATCH = 20;

export type ReviewNotifyDeps = {
  db: Database;
  target: NotifyTarget | null;
  fetchFn?: typeof fetch;
  now?: () => Date;
};

export function reviewNotifyJob(deps: ReviewNotifyDeps): Job {
  return {
    name: "review-notify",
    intervalMs: REVIEW_NOTIFY_INTERVAL_MS,
    run: async () => {
      const waiting = await deps.db
        .select({
          id: orgs.id,
          legalName: orgs.legalName,
          country: orgs.country,
          createdAt: orgs.createdAt,
        })
        .from(orgs)
        .where(and(eq(orgs.status, "pending_review"), isNull(orgs.reviewNotifiedAt)))
        .orderBy(asc(orgs.createdAt))
        .limit(BATCH);
      if (!deps.target) return { waiting: waiting.length, sent: 0, skipped: true };
      let sent = 0;
      let refused = 0;
      let failed = 0;
      for (const org of waiting) {
        const result = await sendNotification(deps.target, reviewMessage(org), deps.fetchFn);
        if (result === "failed") {
          failed += 1;
          continue;
        }
        await deps.db
          .update(orgs)
          .set({ reviewNotifiedAt: deps.now?.() ?? new Date() })
          .where(eq(orgs.id, org.id));
        if (result === "sent") sent += 1;
        else refused += 1;
      }
      return { waiting: waiting.length, sent, refused, failed, service: deps.target.kind };
    },
  };
}
