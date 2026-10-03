// /app/[org]/setup (F-03, F-04, 09 section 1): the owner's confidential account setup and funding. The
// keys unlock in the crypto Web Worker only after an explicit click (AC-03.2, step 1.5); the network
// view (06 section 0), the wrapped mint (AC-03.1), the account (AC-03.3), the balances (AC-03.4,
// AC-03.5), funding (AC-04.x) and the viewing key (07 section 5) come in step 1.7. Money features need
// an active org (AC-02.2), so an org in review or suspended goes back to onboarding.
import { PageHeader } from "@sotto/ui";
import { notFound, redirect } from "next/navigation";
import { ownerNav } from "../../../../lib/org-nav.ts";
import { currentSession } from "../../../../lib/server/current-session.ts";
import { getDb } from "../../../../lib/server/db.ts";
import { ApiError } from "../../../../lib/server/errors.ts";
import { loadMe } from "../../../../lib/server/me.ts";
import { loadNetworkView } from "../../../../lib/server/network-view.ts";
import { readOrgTokenAccount } from "../../../../lib/server/token-accounts.ts";
import { readViewerKey } from "../../../../lib/server/viewer-keys.ts";
import { AppShell } from "../../_components/app-shell.tsx";
import { SetupPanel } from "./setup-panel.tsx";

export const dynamic = "force-dynamic";

export default async function SetupPage({ params }: { params: Promise<{ org: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/app/sign-in");
  const { org: orgId } = await params;
  const db = getDb();
  const me = await loadMe(db, session);
  const owned = me.memberships.find((m) => m.orgId === orgId && m.role === "owner");
  if (!owned) notFound();
  if (owned.orgStatus !== "active") redirect("/app/onboarding");
  const [viewerKey, network] = await Promise.all([
    readViewerKey(db, session, session.userId).catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }),
    loadNetworkView({ orgId }),
  ]);
  const recorded = network.available
    ? await readOrgTokenAccount(db, session.userId, orgId, network.cluster)
    : null;
  return (
    <AppShell me={me} network={network} nav={ownerNav(orgId, "setup")}>
      <PageHeader overline={owned.orgName} title="Account setup" />
      {network.available ? (
        <SetupPanel
          wallet={me.user.wallet}
          orgId={orgId}
          network={network}
          viewerKey={
            viewerKey
              ? { publicKey: viewerKey.publicKey, createdAt: viewerKey.createdAt.toISOString() }
              : null
          }
          recorded={
            recorded ? { address: recorded.address, applyFlagged: recorded.applyFlagged } : null
          }
        />
      ) : (
        <p role="status">
          Sotto runs on devnet only during the beta, so confidential accounts are not available on
          this network.
        </p>
      )}
    </AppShell>
  );
}
