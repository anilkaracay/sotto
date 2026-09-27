// /app/[org]/setup (F-03, 09 section 1): the owner's confidential account setup. Step 1.5 builds its
// keys part: the confidential keys, unlocked in the crypto Web Worker only after an explicit click
// (AC-03.2, the Locked state of AC-03.5), and the viewing key registration (07 section 5). Money
// features need an active org (AC-02.2), so an org in review or suspended goes back to onboarding.
import { PageHeader } from "@sotto/ui";
import { notFound, redirect } from "next/navigation";
import { currentSession } from "../../../../lib/server/current-session.ts";
import { getDb } from "../../../../lib/server/db.ts";
import { ApiError } from "../../../../lib/server/errors.ts";
import { loadMe } from "../../../../lib/server/me.ts";
import { readViewerKey } from "../../../../lib/server/viewer-keys.ts";
import { networkLabel } from "../../../../lib/network.ts";
import { AppShell } from "../../_components/app-shell.tsx";
import { KeysPanel } from "./keys-panel.tsx";

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
  const viewerKey = await readViewerKey(db, session, session.userId).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  });
  return (
    <AppShell me={me} network={networkLabel(process.env.NEXT_PUBLIC_CLUSTER)}>
      <PageHeader overline={owned.orgName} title="Account setup" />
      <KeysPanel
        wallet={me.user.wallet}
        viewerKey={
          viewerKey
            ? { publicKey: viewerKey.publicKey, createdAt: viewerKey.createdAt.toISOString() }
            : null
        }
      />
    </AppShell>
  );
}
