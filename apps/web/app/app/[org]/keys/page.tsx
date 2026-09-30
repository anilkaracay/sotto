// /app/[org]/keys (F-10, F-14, 09 sections 1 and 3; step 2.4): the viewing keys page on the design's
// Access screen: who can read the org (coverage computed in the tab from record counts), the latest
// active key, the keys table with revoke, the access log, the grant drawer with its invite link, and
// the back fill of a grant that became active. Only for the owner of an active org (AC-02.2).
import { PageHeader } from "@sotto/ui";
import { notFound, redirect } from "next/navigation";
import { ownerNav } from "../../../../lib/org-nav.ts";
import { listAccessLog } from "../../../../lib/server/access-log.ts";
import { currentSession } from "../../../../lib/server/current-session.ts";
import { getDb } from "../../../../lib/server/db.ts";
import { orgOwnerWallet } from "../../../../lib/server/disclosures.ts";
import { ApiError } from "../../../../lib/server/errors.ts";
import { listGrants } from "../../../../lib/server/grants.ts";
import { loadMe } from "../../../../lib/server/me.ts";
import { loadNetworkView } from "../../../../lib/server/network-view.ts";
import { readViewerKey } from "../../../../lib/server/viewer-keys.ts";
import { AppShell } from "../../_components/app-shell.tsx";
import { KeysPanel } from "./keys-panel.tsx";

export const dynamic = "force-dynamic";

export default async function KeysPage({ params }: { params: Promise<{ org: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/app/sign-in");
  const { org: orgId } = await params;
  const db = getDb();
  const me = await loadMe(db, session);
  const owned = me.memberships.find((m) => m.orgId === orgId && m.role === "owner");
  if (!owned) notFound();
  if (owned.orgStatus !== "active") redirect("/app/onboarding");
  const [grants, events, ownerKey, ownerWallet, network] = await Promise.all([
    listGrants(db, session, orgId),
    listAccessLog(db, session, orgId, 7),
    readViewerKey(db, session, session.userId).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }),
    orgOwnerWallet(db, orgId),
    loadNetworkView(),
  ]);
  return (
    <AppShell me={me} network={network} nav={ownerNav(orgId, "keys")}>
      {network.available ? (
        <KeysPanel
          wallet={me.user.wallet}
          you={session.userId}
          orgId={orgId}
          orgName={owned.orgName}
          ownerWallet={ownerWallet ?? me.user.wallet}
          network={network}
          grants={grants.grants}
          ownerItems={grants.ownerItems}
          events={events}
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
        <>
          <PageHeader overline="Access" title="Viewing keys" />
          <p role="status">
            Sotto runs on devnet only during the beta, so viewing keys are not available on this
            network.
          </p>
        </>
      )}
    </AppShell>
  );
}
