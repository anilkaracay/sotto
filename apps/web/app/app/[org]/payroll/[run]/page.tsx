// /app/[org]/payroll/[run] (F-08, 09 sections 1 and 3; step 2.3): a payroll run with its run total
// by team (decrypted in the tab), the settlement gauge, the approvals block with the
// initiator's approval only, the recipients with each line's status, and Approve and
// run or Resume. Only for the owner of an active org (AC-02.2).
import { monthLabel } from "../../../../../lib/books.ts";
import { PageHeader } from "@sotto/ui";
import { notFound, redirect } from "next/navigation";
import { ownerNav } from "../../../../../lib/org-nav.ts";
import { serverCluster } from "../../../../../lib/server/cluster.ts";
import { currentSession } from "../../../../../lib/server/current-session.ts";
import { getDb } from "../../../../../lib/server/db.ts";
import { ApiError } from "../../../../../lib/server/errors.ts";
import { loadMe } from "../../../../../lib/server/me.ts";
import { loadNetworkView } from "../../../../../lib/server/network-view.ts";
import { recipientViewerKeys } from "../../../../../lib/server/payments.ts";
import { readRun } from "../../../../../lib/server/payroll.ts";
import { readViewerKey } from "../../../../../lib/server/viewer-keys.ts";
import { AppShell } from "../../../_components/app-shell.tsx";
import { RunPanel } from "./run-panel.tsx";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function PayrollRunPage({
  params,
}: {
  params: Promise<{ org: string; run: string }>;
}) {
  const session = await currentSession();
  if (!session) redirect("/app/sign-in");
  const { org: orgId, run: runId } = await params;
  if (!UUID.test(runId)) notFound();
  const db = getDb();
  const me = await loadMe(db, session);
  const owned = me.memberships.find((m) => m.orgId === orgId && m.role === "owner");
  if (!owned) notFound();
  if (owned.orgStatus !== "active") redirect("/app/onboarding");
  const cluster = await serverCluster();
  const [run, keys, ownerKey, network] = await Promise.all([
    readRun(db, session, orgId, runId, cluster).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }),
    recipientViewerKeys(db, session, orgId),
    readViewerKey(db, session, session.userId).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }),
    loadNetworkView({ orgId }),
  ]);
  if (!run) notFound();
  return (
    <AppShell me={me} network={network} nav={ownerNav(orgId, "payroll")}>
      <PageHeader overline={`Payroll run, ${monthLabel(run.period, true)}`} title={run.title} />
      {network.available ? (
        <RunPanel
          wallet={me.user.wallet}
          orgId={orgId}
          network={network}
          run={run}
          you={{ displayName: me.user.displayName }}
          viewerKeys={keys}
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
