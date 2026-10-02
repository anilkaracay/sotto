// The access log writer (F-14, AC-14.1; step 2.4), shared by the web server and the worker: one row
// per event, metadata only. The metadata is ids, counts, scopes, statuses and dates; a key named like
// an amount anywhere in it is refused before anything is written (the golden rule, 08 section 1).
import type { Database } from "./client.ts";
import { forbiddenMetadataKeys } from "./golden-rule.ts";
import { accessLog } from "./schema.ts";

export type AccessMetadata = Record<
  string,
  string | number | boolean | null | readonly (string | number)[]
>;

export type AccessEvent = {
  orgId: string;
  /** Null for the worker. */
  actorUserId: string | null;
  action: string;
  subjectType: "grant" | "manifest" | "payment" | "payroll_run" | "export" | "proof";
  subjectId: string;
  metadata?: AccessMetadata;
  /**
   * When it happened, if not now (step 4.2.2): a settlement is dated by its block's time, the
   * moment it settled on Solana, not when the worker saw it finalized.
   */
  at?: Date;
};

/** A database or a transaction: anything that can insert. */
export type AccessLogWriter = Pick<Database, "insert">;

export async function insertAccessEvent(db: AccessLogWriter, event: AccessEvent): Promise<void> {
  const metadata = event.metadata ?? {};
  const forbidden = forbiddenMetadataKeys(metadata);
  if (forbidden.length > 0) {
    throw new Error(`access log metadata holds no amount: ${forbidden.join(", ")}`);
  }
  await db.insert(accessLog).values({
    orgId: event.orgId,
    actorUserId: event.actorUserId,
    action: event.action,
    subjectType: event.subjectType,
    subjectId: event.subjectId,
    metadata,
    ...(event.at ? { createdAt: event.at } : {}),
  });
}
