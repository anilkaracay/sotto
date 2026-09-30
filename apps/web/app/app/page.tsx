// /app (09 section 1): sends a signed out visitor to the sign in screen. The owner of an active
// organization goes to its overview (since step 1.10); a user who owns an organization in review or
// suspended goes to /app/onboarding; otherwise the user's places are the books of each active
// organization where they hold a viewing key (step 2.5, AC-11.1) and the pay page of each active
// organization that pays them (step 1.10): one place opens directly, several are listed to choose
// from. A user with no organization goes to onboarding. Members with other roles see the shell until
// their pages exist.
import { Card, PageHeader } from "@sotto/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { listBooksOrgs } from "../../lib/server/books.ts";
import { currentSession } from "../../lib/server/current-session.ts";
import { getDb } from "../../lib/server/db.ts";
import { loadMe } from "../../lib/server/me.ts";
import { loadNetworkView } from "../../lib/server/network-view.ts";
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
  const places = [
    ...(await listBooksOrgs(getDb(), session)).map((org) => ({
      href: `/app/${org.orgId}/books`,
      label: `Books of ${org.orgName}`,
      detail: "Read only, with the viewing key it shared with you",
    })),
    ...me.memberships
      .filter((m) => m.role === "recipient" && m.orgStatus === "active")
      .map((m) => ({
        href: `/app/${m.orgId}/pay`,
        label: `Your pay from ${m.orgName}`,
        detail: "The payments it sends you",
      })),
  ];
  const [only] = places;
  if (only && places.length === 1) redirect(only.href);
  if (me.memberships.length === 0) redirect("/app/onboarding");
  return (
    <AppShell me={me} network={await loadNetworkView()}>
      <PageHeader
        overline={`Signed in with ${shortWallet(me.user.wallet)}`}
        title="Welcome to Sotto"
      />
      <Card>
        {places.length > 0 ? (
          <ul style={{ display: "grid", gap: 12, listStyle: "none" }} data-testid="places">
            {places.map((place) => (
              <li key={place.href}>
                <Link href={place.href} style={{ fontSize: 15, fontWeight: 500 }}>
                  {place.label}
                </Link>
                <p style={{ fontSize: 13.5, color: "var(--muted)" }}>{place.detail}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ fontSize: 14.5, color: "var(--ink2)" }} data-testid="no-places">
            {me.memberships.some((m) => m.role === "accountant")
              ? "No organization shares its books with you right now."
              : "The pages for your role in this organization are not available yet."}
          </p>
        )}
      </Card>
    </AppShell>
  );
}
