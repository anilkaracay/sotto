// /app/[org]/payments/new (F-06, 09 section 1; step 1.9): a single confidential payment to a recipient
// whose account is ready, and the org's recent payments with their status. Only for the owner of an
// active org (AC-02.2); an org in review or suspended goes to onboarding.
import { PageHeader } from "@sotto/ui";
import { notFound, redirect } from "next/navigation";
import { ownerNav } from "../../../../../lib/org-nav.ts";
import { serverCluster } from "../../../../../lib/server/cluster.ts";
import { currentSession } from "../../../../../lib/server/current-session.ts";
import { getDb } from "../../../../../lib/server/db.ts";
import { ApiError } from "../../../../../lib/server/errors.ts";
import { loadMe } from "../../../../../lib/server/me.ts";
import { loadNetworkView } from "../../../../../lib/server/network-view.ts";
import { listPayments, recipientViewerKeys } from "../../../../../lib/server/payments.ts";
import { listRecipients } from "../../../../../lib/server/recipients.ts";
import { readViewerKey } from "../../../../../lib/server/viewer-keys.ts";
import { AppShell } from "../../../_components/app-shell.tsx";
import { PaymentsPanel } from "./payments-panel.tsx";

export const dynamic = "force-dynamic";

export default async function NewPaymentPage({ params }: { params: Promise<{ org: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/app/sign-in");
  const { org: orgId } = await params;
  const db = getDb();
  const me = await loadMe(db, session);
  const owned = me.memberships.find((m) => m.orgId === orgId && m.role === "owner");
  if (!owned) notFound();
  if (owned.orgStatus !== "active") redirect("/app/onboarding");
  const cluster = await serverCluster();
  const [recipients, keys, payments, ownerKey, network] = await Promise.all([
    listRecipients(db, session, orgId),
    recipientViewerKeys(db, session, orgId),
    listPayments(db, session, orgId, cluster),
    readViewerKey(db, session, session.userId).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }),
    loadNetworkView({ orgId }),
  ]);
  return (
    <AppShell me={me} network={network} nav={ownerNav(orgId, "payments")}>
      <PageHeader overline={owned.orgName} title="Payments" />
      {network.available ? (
        <PaymentsPanel
          wallet={me.user.wallet}
          orgId={orgId}
          network={network}
          recipients={recipients.map((recipient) => ({
            id: recipient.id,
            displayName: recipient.displayName,
            wallet: recipient.wallet,
            readiness: recipient.readiness,
            privateBlob: recipient.privateBlob,
            viewerKey: keys[recipient.id] ?? null,
          }))}
          payments={payments}
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
          Sotto runs on devnet only during the beta, so payments are not available on this network.
        </p>
      )}
    </AppShell>
  );
}
