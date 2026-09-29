// /app/[org]/payroll (F-08, 09 section 1; step 2.3): a new payroll run from a CSV the owner uploads,
// validated row by row in the tab (AC-08.1), and the org's runs with their status (AC-08.2). Only for
// the owner of an active org (AC-02.2); an org in review or suspended goes to onboarding.
import { PageHeader } from "@sotto/ui";
import { notFound, redirect } from "next/navigation";
import { ownerNav } from "../../../../lib/org-nav.ts";
import { currentSession } from "../../../../lib/server/current-session.ts";
import { getDb } from "../../../../lib/server/db.ts";
import { ApiError } from "../../../../lib/server/errors.ts";
import { loadMe } from "../../../../lib/server/me.ts";
import { loadNetworkView } from "../../../../lib/server/network-view.ts";
import { listRuns } from "../../../../lib/server/payroll.ts";
import { listRecipients } from "../../../../lib/server/recipients.ts";
import { readViewerKey } from "../../../../lib/server/viewer-keys.ts";
import { AppShell } from "../../_components/app-shell.tsx";
import { PayrollPanel } from "./payroll-panel.tsx";

export const dynamic = "force-dynamic";

export default async function PayrollPage({ params }: { params: Promise<{ org: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/app/sign-in");
  const { org: orgId } = await params;
  const db = getDb();
  const me = await loadMe(db, session);
  const owned = me.memberships.find((m) => m.orgId === orgId && m.role === "owner");
  if (!owned) notFound();
  if (owned.orgStatus !== "active") redirect("/app/onboarding");
  const [recipients, runs, ownerKey, network] = await Promise.all([
    listRecipients(db, session, orgId),
    listRuns(db, session, orgId),
    readViewerKey(db, session, session.userId).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }),
    loadNetworkView(),
  ]);
  return (
    <AppShell me={me} network={network.label} nav={ownerNav(orgId, "payroll")}>
      <PageHeader overline={owned.orgName} title="Payroll" />
      {network.available ? (
        <PayrollPanel
          wallet={me.user.wallet}
          orgId={orgId}
          network={network}
          recipients={recipients.map((recipient) => ({
            id: recipient.id,
            displayName: recipient.displayName,
            wallet: recipient.wallet,
            team: recipient.team,
            country: recipient.country,
            readiness: recipient.readiness,
          }))}
          runs={runs}
          ownerKey={
            ownerKey
              ? {
                  userId: ownerKey.userId,
                  wallet: ownerKey.wallet,
                  publicKey: ownerKey.publicKey,
                  signature: ownerKey.signature,
                }
              : null
          }
        />
      ) : (
        <p role="status">
          Sotto runs on devnet only during the beta, so payroll is not available on this network.
        </p>
      )}
    </AppShell>
  );
}
