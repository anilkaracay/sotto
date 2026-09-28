// /app/[org]/pay (09 section 1; step 1.10): the recipient's minimal pay page until My pay in Phase 2.
// The recipient's balances (decrypted in this tab after an unlock), the payments received from their
// disclosures (verified against the org owner's manifest signature and opened in this tab, I-9), and
// withdraw and unwrap (F-09, AC-09.1). Only for a recipient of the org; the org must be active.
import { PageHeader } from "@sotto/ui";
import { notFound, redirect } from "next/navigation";
import { recipientNav } from "../../../../lib/org-nav.ts";
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
      <AppShell me={me} network={(await loadNetworkView()).label}>
        <PageHeader overline={membership.orgName} title={title} />
        <p role="status">
          {membership.orgName} is not active in Sotto right now, so its payments are not available.
        </p>
      </AppShell>
    );
  }
  const [network, ownerWallet] = await Promise.all([loadNetworkView(), orgOwnerWallet(db, orgId)]);
  if (!ownerWallet) notFound();
  return (
    <AppShell me={me} network={network.label} nav={recipientNav(orgId)}>
      <PageHeader overline={membership.orgName} title={title} />
      {network.available ? (
        <PayPanel
          wallet={me.user.wallet}
          userId={me.user.id}
          orgId={orgId}
          orgName={membership.orgName}
          ownerWallet={ownerWallet}
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
