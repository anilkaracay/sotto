// /app/[org]/recipients (F-07, 09 section 1; step 1.8): the owner's recipients with their readiness
// from chain (AC-07.1 to AC-07.4), invite links, and default amounts sealed to the owner's viewing key.
// Only for the owner of an active org (AC-02.2); an org in review or suspended goes to onboarding.
import { PageHeader } from "@sotto/ui";
import { notFound, redirect } from "next/navigation";
import { ownerNav } from "../../../../lib/org-nav.ts";
import { currentSession } from "../../../../lib/server/current-session.ts";
import { getDb } from "../../../../lib/server/db.ts";
import { ApiError } from "../../../../lib/server/errors.ts";
import { loadMe } from "../../../../lib/server/me.ts";
import { loadNetworkView } from "../../../../lib/server/network-view.ts";
import { listRecipients } from "../../../../lib/server/recipients.ts";
import { readViewerKey } from "../../../../lib/server/viewer-keys.ts";
import { AppShell } from "../../_components/app-shell.tsx";
import { RecipientsPanel } from "./recipients-panel.tsx";

export const dynamic = "force-dynamic";

export default async function RecipientsPage({ params }: { params: Promise<{ org: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/app/sign-in");
  const { org: orgId } = await params;
  const db = getDb();
  const me = await loadMe(db, session);
  const owned = me.memberships.find((m) => m.orgId === orgId && m.role === "owner");
  if (!owned) notFound();
  if (owned.orgStatus !== "active") redirect("/app/onboarding");
  const [recipients, viewerKey, network] = await Promise.all([
    listRecipients(db, session, orgId),
    readViewerKey(db, session, session.userId).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }),
    loadNetworkView({ orgId }),
  ]);
  return (
    <AppShell me={me} network={network} nav={ownerNav(orgId, "recipients")}>
      <PageHeader overline={owned.orgName} title="Recipients" />
      {network.available ? (
        <RecipientsPanel
          wallet={me.user.wallet}
          orgId={orgId}
          network={network}
          recipients={recipients}
          viewerKey={
            viewerKey ? { publicKey: viewerKey.publicKey, signature: viewerKey.signature } : null
          }
        />
      ) : (
        <p role="status">
          Sotto runs on devnet only during the beta, so recipients are not available on this
          network.
        </p>
      )}
    </AppShell>
  );
}
