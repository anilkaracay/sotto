// /app/[org]/proofs (F-13, 09 section 4 "Proofs"; step 2.8): the owner proves "Balance is at least $X"
// to a counterparty without showing the balance. The builder, the certificate on the sky card once the
// record is written, and the issued proofs with each record's state from chain. Only for the owner of
// an active organization (AC-02.2); an organization in review or suspended goes to onboarding.
import { PageHeader } from "@sotto/ui";
import { notFound, redirect } from "next/navigation";
import { ownerNav } from "../../../../lib/org-nav.ts";
import { orgAsset } from "../../../../lib/server/assets.ts";
import { serverRpc } from "../../../../lib/server/chain.ts";
import { serverCluster } from "../../../../lib/server/cluster.ts";
import { currentSession } from "../../../../lib/server/current-session.ts";
import { getDb } from "../../../../lib/server/db.ts";
import { loadMe } from "../../../../lib/server/me.ts";
import { loadNetworkView } from "../../../../lib/server/network-view.ts";
import { listProofs, proofsPaused } from "../../../../lib/server/proofs.ts";
import { AppShell } from "../../_components/app-shell.tsx";
import { ProofsPanel } from "./proofs-panel.tsx";

export const dynamic = "force-dynamic";

export default async function ProofsPage({ params }: { params: Promise<{ org: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/app/sign-in");
  const { org: orgId } = await params;
  const db = getDb();
  const me = await loadMe(db, session);
  const owned = me.memberships.find((m) => m.orgId === orgId && m.role === "owner");
  if (!owned) notFound();
  if (owned.orgStatus !== "active") redirect("/app/onboarding");
  const [cluster, network] = await Promise.all([serverCluster(), loadNetworkView({ orgId })]);
  // The organization's asset's own sotto_proofs deployment (step 4.3, D-29): a config holds one mint.
  const program = cluster
    ? ((await orgAsset(db, cluster, orgId))?.sottoProofs?.program ?? null)
    : null;
  const [{ proofs }, paused] = program
    ? await Promise.all([
        listProofs(db, session, orgId, serverRpc()),
        proofsPaused(serverRpc(), getDb(), cluster, orgId),
      ])
    : [{ proofs: [] }, false];
  return (
    <AppShell me={me} network={network} nav={ownerNav(orgId, "proofs")}>
      <PageHeader overline="Proofs" title="Prove it, without showing it" />
      {network.available && program ? (
        <ProofsPanel
          wallet={me.user.wallet}
          orgId={orgId}
          orgName={owned.orgName}
          network={network}
          program={program}
          proofs={proofs}
          paused={paused}
        />
      ) : (
        <p role="status">
          Proofs of funds are not available on this network: the proof program is not deployed here.
        </p>
      )}
    </AppShell>
  );
}
