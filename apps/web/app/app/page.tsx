// /app (09 section 1): sends a signed out visitor to the sign in screen. The owner of an active
// organization goes to its overview (since step 1.10); a user who owns an organization in review or
// suspended goes to /app/onboarding; a recipient of an active organization goes to its pay page (step
// 1.10); a user with no organization goes to onboarding. Members with other roles see the shell until
// their pages exist.
import { Card, PageHeader } from "@sotto/ui";
import { redirect } from "next/navigation";
import { currentSession } from "../../lib/server/current-session.ts";
import { getDb } from "../../lib/server/db.ts";
import { loadMe } from "../../lib/server/me.ts";
import { currentNetworkLabel } from "../../lib/network.ts";
import { shortWallet } from "../../lib/format.ts";
import { AppShell } from "./_components/app-shell.tsx";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const session = await currentSession();
  if (!session) redirect("/app/sign-in");
  const me = await loadMe(getDb(), session);
  const owned = me.memberships.find((m) => m.role === "owner");
  if (owned?.orgStatus === "active") redirect(`/app/${owned.orgId}/overview`);
  if (owned) redirect("/app/onboarding");
  const paid = me.memberships.find((m) => m.role === "recipient" && m.orgStatus === "active");
  if (paid) redirect(`/app/${paid.orgId}/pay`);
  if (me.memberships.length === 0) redirect("/app/onboarding");
  return (
    <AppShell me={me} network={currentNetworkLabel()}>
      <PageHeader
        overline={`Signed in with ${shortWallet(me.user.wallet)}`}
        title="Welcome to Sotto"
      />
      <Card>
        <p style={{ fontSize: 14.5, color: "var(--ink2)" }}>
          The pages for your role in this organization are not available yet.
        </p>
      </Card>
    </AppShell>
  );
}
