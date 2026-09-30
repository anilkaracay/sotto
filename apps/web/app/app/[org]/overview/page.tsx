// /app/[org]/overview (09 sections 1 and 3): the owner overview, the first page of an owner of an
// active org. Step 1.7 built its balance cards (AC-05.1): the confidential available and pending
// balances, decrypted in this tab for the owner only after an explicit unlock, and the public wUSDC
// and USDC balances. Step 1.10 adds the welcome, the confidential account card, the recent activity
// and withdraw (F-09). Only for the owner of an active org (AC-02.2).
import { PageHeader } from "@sotto/ui";
import { notFound, redirect } from "next/navigation";
import { ownerNav } from "../../../../lib/org-nav.ts";
import { currentSession } from "../../../../lib/server/current-session.ts";
import { getDb } from "../../../../lib/server/db.ts";
import { loadMe } from "../../../../lib/server/me.ts";
import { loadNetworkView } from "../../../../lib/server/network-view.ts";
import { AppShell } from "../../_components/app-shell.tsx";
import { OverviewPanel } from "./overview-panel.tsx";

export const dynamic = "force-dynamic";

export default async function OverviewPage({ params }: { params: Promise<{ org: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/app/sign-in");
  const { org: orgId } = await params;
  const me = await loadMe(getDb(), session);
  const owned = me.memberships.find((m) => m.orgId === orgId && m.role === "owner");
  if (!owned) notFound();
  if (owned.orgStatus !== "active") redirect("/app/onboarding");
  const network = await loadNetworkView();
  return (
    <AppShell me={me} network={network} nav={ownerNav(orgId, "overview")}>
      {network.available ? (
        <OverviewPanel
          wallet={me.user.wallet}
          userId={me.user.id}
          orgId={orgId}
          orgName={owned.orgName}
          displayName={me.user.displayName}
          network={network}
        />
      ) : (
        <>
          <PageHeader overline={owned.orgName} title="Overview" />
          <p role="status">
            Sotto runs on devnet only during the beta, so balances are not available on this
            network.
          </p>
        </>
      )}
    </AppShell>
  );
}
