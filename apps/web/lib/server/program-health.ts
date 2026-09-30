// F-19 (AC-19.1; step 2.9): the ZK ElGamal Proof program's health as the app shows it, from the verdict
// the worker's proof-program-health job stores every 5 minutes in `cluster_health` (step 1.9). The
// program is unavailable when the latest verdict failed, or when there has been no success in the last
// 15 minutes (the job stores nothing when it cannot reach the RPC, so an old success ages out; the
// same limit the payment and payroll authorizations use). An unreachable network is told apart by the
// page's own network check (D-14), never by this verdict.
import { clusterHealth, type Database } from "@sotto/db";
import { eq } from "drizzle-orm";
import { PROOF_PROGRAM_MAX_AGE_MS } from "./payments.ts";

export type ProgramHealth =
  | { status: "ok" }
  | {
      status: "unavailable";
      /** failing: the latest check failed; stale: no success in the last 15 minutes. */
      reason: "failing" | "stale";
      /** When the latest verdict was stored, if any (ISO). */
      checkedAt: string | null;
    };

export async function readProgramHealth(
  db: Database,
  cluster: "localnet" | "devnet" | "mainnet",
  now = new Date(),
): Promise<ProgramHealth> {
  const [row] = await db
    .select({ ok: clusterHealth.proofProgramOk, checkedAt: clusterHealth.checkedAt })
    .from(clusterHealth)
    .where(eq(clusterHealth.cluster, cluster))
    .limit(1);
  return programHealthOf(row ?? null, now);
}

/** The rule above on a stored verdict (exported for the unit tests). */
export function programHealthOf(
  row: { ok: boolean; checkedAt: Date } | null,
  now: Date,
): ProgramHealth {
  if (!row) return { status: "unavailable", reason: "stale", checkedAt: null };
  const checkedAt = row.checkedAt.toISOString();
  if (!row.ok) return { status: "unavailable", reason: "failing", checkedAt };
  if (now.getTime() - row.checkedAt.getTime() > PROOF_PROGRAM_MAX_AGE_MS) {
    return { status: "unavailable", reason: "stale", checkedAt };
  }
  return { status: "ok" };
}
