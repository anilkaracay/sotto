// /app/[org]/pay (09 section 1; step 1.10, My pay since step 2.6, F-12): the recipient's pay from each
// active organization that pays them, grouped by organization with this page's first (its payslips,
// pay history and what the chain shows, from their own records opened in the tab, I-9), then their
// balances and withdraw and unwrap (F-09, AC-09.1). Only for a recipient of the org; the org must be
// active. The header names the organization and the recipient's role there.
import { recipients } from "@sotto/db";
import { PageHeader } from "@sotto/ui";
import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { recipientNav } from "../../../../lib/org-nav.ts";
import { payOrgs } from "../../../../lib/pay.ts";
import { currentSession } from "../../../../lib/server/current-session.ts";
import { getDb } from "../../../../lib/server/db.ts";
import { orgOwnerWallet } from "../../../../lib/server/disclosures.ts";
import { loadMe } from "../../../../lib/server/me.ts";
import { loadNetworkView } from "../../../../lib/server/network-view.ts";
import { AppShell } from "../../_components/app-shell.tsx";
import { PayPanel } from "./pay-panel.tsx";

export const dynamic = "force-dynamic";

export default async function PayPage({ params }: { params: Promise<{ org: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/app/sign-in");
  const { org: orgId } = await params;
  const db = getDb();
  const me = await loadMe(db, session);
  const membership = me.memberships.find((m) => m.orgId === orgId && m.role === "recipient");
  if (!membership) notFound();
  const first = me.user.displayName?.trim().split(/\s+/)[0] ?? null;
  const title = first ? `Your pay, ${first}` : "Your pay";
  if (membership.orgStatus !== "active") {
    return (
      <AppShell me={me} network={await loadNetworkView()}>
        <PageHeader overline={membership.orgName} title={title} />
        <p role="status">
          {membership.orgName} is not active in Sotto right now, so its payments are not available.
        </p>
      </AppShell>
    );
  }
  const [network, ownerWallet, [recipient]] = await Promise.all([
    loadNetworkView(),
    orgOwnerWallet(db, orgId),
    db
      .select({ roleTitle: recipients.roleTitle })
      .from(recipients)
      .where(and(eq(recipients.orgId, orgId), eq(recipients.userId, session.userId)))
      .limit(1),
  ]);
  if (!ownerWallet) notFound();
  const orgs = payOrgs(me.memberships, orgId);
  const overline = recipient?.roleTitle
    ? `${membership.orgName}, ${recipient.roleTitle}`
    : membership.orgName;
  return (
    <AppShell me={me} network={network} nav={recipientNav(orgId)}>
      <PageHeader overline={overline} title={title} />
      {network.available ? (
        <PayPanel
          wallet={me.user.wallet}
          userId={me.user.id}
          orgId={orgId}
          orgs={orgs}
          network={network}
        />
      ) : (
        <p role="status">
          Sotto runs on devnet only during the beta, so balances are not available on this network.
        </p>
      )}
    </AppShell>
  );
}
