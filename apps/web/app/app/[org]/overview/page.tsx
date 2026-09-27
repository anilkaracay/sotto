// /app/[org]/overview (09 sections 1 and 3): the owner overview. Step 1.7 builds its balance cards
// (AC-05.1): the confidential available and pending balances, decrypted in this tab for the owner only
// after an explicit unlock, and the public wUSDC and USDC balances; the welcome, the confidential
// account card and recent activity come in step 1.10. Only for the owner of an active org (AC-02.2).
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
    <AppShell me={me} network={network.label} nav={ownerNav(orgId, "overview")}>
      <PageHeader overline={owned.orgName} title="Overview" />
      {network.available ? (
        <OverviewPanel wallet={me.user.wallet} orgId={orgId} network={network} />
      ) : (
        <p role="status">
          Sotto runs on devnet only during the beta, so balances are not available on this network.
        </p>
      )}
    </AppShell>
  );
}
