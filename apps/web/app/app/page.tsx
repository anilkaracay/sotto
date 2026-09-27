// /app (09 section 1): sends a signed out visitor to the sign in screen. Signed in, it shows the shell;
// the redirect to the first page of the user's role arrives with the org screens (1.4 and later).
import { Card, PageHeader } from "@sotto/ui";
import { redirect } from "next/navigation";
import { currentSession } from "../../lib/server/current-session.ts";
import { getDb } from "../../lib/server/db.ts";
import { loadMe } from "../../lib/server/me.ts";
import { networkLabel } from "../../lib/network.ts";
import { shortWallet } from "../../lib/format.ts";
import { AppShell } from "./_components/app-shell.tsx";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const session = await currentSession();
  if (!session) redirect("/app/sign-in");
  const me = await loadMe(getDb(), session);
  return (
    <AppShell me={me} network={networkLabel(process.env.NEXT_PUBLIC_CLUSTER)}>
      <PageHeader
        overline={`Signed in with ${shortWallet(me.user.wallet)}`}
        title="Welcome to Sotto"
      />
      {me.memberships.length === 0 ? (
        <Card>
          <p style={{ fontSize: 14.5, color: "var(--ink2)" }}>
            You are not a member of an organization yet.
          </p>
        </Card>
      ) : null}
    </AppShell>
  );
}
