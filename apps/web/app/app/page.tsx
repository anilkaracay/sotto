// /app (09 section 1): sends a signed out visitor to the sign in screen. The owner of an active
// organization goes to its overview (since step 1.10); a user who owns an organization in review or
// suspended goes to /app/onboarding; otherwise the user's places are the books of each active
// organization where they hold a viewing key (step 2.5, AC-11.1) and the pay page of each active
// organization that pays them (step 1.10): one place opens directly, several are listed to choose
// from, each a tile of the app theme (design pass C, step 3.6). A user with no organization goes
// to onboarding. Members with other roles see the shell until
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
import styles from "./places.module.css";

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
      kind: "books" as const,
      href: `/app/${org.orgId}/books`,
      label: `Books of ${org.orgName}`,
      detail: "Read only, with the viewing key it shared with you",
    })),
    ...me.memberships
      .filter((m) => m.role === "recipient" && m.orgStatus === "active")
      .map((m) => ({
        kind: "pay" as const,
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
      {places.length > 0 ? (
        <ul className={styles.places} data-testid="places">
          {places.map((place) => (
            <li key={place.href}>
              <Link href={place.href} className={styles.place}>
                <span className={styles.placeIcon} aria-hidden="true">
                  {place.kind === "books" ? (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z" />
                      <path d="M4 19V5M9 7h6" />
                    </svg>
                  ) : (
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="3" y="6" width="18" height="13" rx="3" />
                      <path d="M3 10h18M16 15h2" />
                    </svg>
                  )}
                </span>
                <span className={styles.placeText}>
                  <b>{place.label}</b>
                  <small>{place.detail}</small>
                </span>
                <span className={styles.placeArrow} aria-hidden="true">
                  →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Card>
          <p className={styles.none} data-testid="no-places">
            {me.memberships.some((m) => m.role === "accountant")
              ? "No organization shares its books with you right now."
              : "The pages for your role in this organization are not available yet."}
          </p>
        </Card>
      )}
    </AppShell>
  );
}
