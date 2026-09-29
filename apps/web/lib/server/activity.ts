// The overview's recent activity (09 section 3; step 2.5): the org's latest payments of both kinds,
// single payments and payroll lines, for its owner, each with who else can read its amount (the
// recipient with their own record, and each holder of a readable grant that holds the payment's
// record), and the owner's own records of them, which the owner's tab verifies (I-9) and opens. The
// readers are names only; no amount exists here.
import {
  disclosures,
  grants,
  manifests,
  orgs,
  payments,
  payrollRuns,
  recipients,
  type Database,
} from "@sotto/db";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { apiErrors } from "./errors.ts";
import type { DisclosureItemView, ManifestView } from "./disclosures.ts";
import { readableGrantCondition } from "./grants.ts";
import { requireMoneyAccess } from "./orgs.ts";
import type { Session } from "./session.ts";

export const activityQuerySchema = z
  .object({ limit: z.coerce.number().int().min(1).max(50).default(8) })
  .strict();

export type ActivityPaymentView = {
  id: string;
  kind: "single" | "payroll_line";
  run: { id: string; title: string } | null;
  recipient: { displayName: string; wallet: string };
  status: string;
  errorCode: string | null;
  createdAt: string;
  settledAt: string | null;
  privateBlob: string | null;
  /** Who besides the owner can read the amount: the recipient, and each grant holding the record. */
  readers: { name: string; via: "recipient" | "grant" }[];
};

export async function listActivity(
  db: Database,
  session: Session | null,
  orgId: string,
  limit: number,
  now = new Date(),
): Promise<{
  payments: ActivityPaymentView[];
  items: DisclosureItemView[];
  manifests: ManifestView[];
}> {
  await requireMoneyAccess(db, session, orgId, ["owner"]);
  const [org] = await db
    .select({ owner: orgs.ownerUserId })
    .from(orgs)
    .where(eq(orgs.id, orgId))
    .limit(1);
  if (!org) throw apiErrors.forbidden();
  const rows = await db
    .select({
      payment: payments,
      name: recipients.displayName,
      wallet: recipients.wallet,
      runTitle: payrollRuns.title,
    })
    .from(payments)
    .innerJoin(recipients, eq(recipients.id, payments.recipientId))
    .leftJoin(payrollRuns, eq(payrollRuns.id, payments.runId))
    .where(eq(payments.orgId, orgId))
    .orderBy(desc(payments.createdAt), desc(payments.lineNo))
    .limit(limit);
  const ids = rows.map((row) => row.payment.id);
  if (ids.length === 0) return { payments: [], items: [], manifests: [] };
  const [others, own] = await Promise.all([
    db
      .select({
        subject: disclosures.subject,
        viewer: disclosures.viewerUserId,
        grantId: disclosures.grantId,
        holder: grants.holderName,
      })
      .from(disclosures)
      .leftJoin(grants, eq(grants.id, disclosures.grantId))
      .where(
        and(
          eq(disclosures.orgId, orgId),
          inArray(disclosures.subject, ids),
          ne(disclosures.viewerUserId, org.owner),
        ),
      ),
    db
      .select()
      .from(disclosures)
      .where(
        and(
          eq(disclosures.orgId, orgId),
          inArray(disclosures.subject, ids),
          eq(disclosures.viewerUserId, org.owner),
          isNull(disclosures.grantId),
        ),
      ),
  ]);
  // A grant's record counts only while the grant can be read (07 section 7).
  const readableGrants = new Set(
    (
      await db
        .select({ id: grants.id })
        .from(grants)
        .where(and(eq(grants.orgId, orgId), readableGrantCondition(now)))
    ).map((row) => row.id),
  );
  const manifestIds = [...new Set(own.map((row) => row.manifestId))];
  const manifestRows = manifestIds.length
    ? await db.select().from(manifests).where(inArray(manifests.id, manifestIds))
    : [];
  return {
    payments: rows.map((row) => {
      const readers: ActivityPaymentView["readers"] = [];
      const seen = new Set<string>();
      for (const other of others.filter((entry) => entry.subject === row.payment.id)) {
        const key = `${other.viewer}:${other.grantId ?? "recipient"}`;
        if (seen.has(key)) continue;
        if (other.grantId === null) {
          seen.add(key);
          readers.push({ name: row.name, via: "recipient" });
        } else if (readableGrants.has(other.grantId)) {
          seen.add(key);
          readers.push({ name: other.holder ?? "Holder", via: "grant" });
        }
      }
      return {
        id: row.payment.id,
        kind: row.payment.kind,
        run:
          row.payment.runId && row.runTitle !== null
            ? { id: row.payment.runId, title: row.runTitle }
            : null,
        recipient: { displayName: row.name, wallet: row.wallet },
        status: row.payment.status,
        errorCode: row.payment.errorCode,
        createdAt: row.payment.createdAt.toISOString(),
        settledAt: row.payment.settledAt?.toISOString() ?? null,
        privateBlob: row.payment.privateBlob
          ? Buffer.from(row.payment.privateBlob).toString("base64")
          : null,
        readers,
      };
    }),
    items: own.map((row) => ({
      id: row.id,
      grantId: row.grantId,
      kind: row.kind,
      subject: row.subject,
      ciphertext: Buffer.from(row.ciphertext).toString("base64"),
      manifestId: row.manifestId,
      createdAt: row.createdAt.toISOString(),
    })),
    manifests: manifestRows.map((manifest) => ({
      id: manifest.id,
      signerWallet: manifest.signerWallet,
      manifest: manifest.manifest,
      signature: Buffer.from(manifest.signature).toString("base64"),
      createdAt: manifest.createdAt.toISOString(),
    })),
  };
}
