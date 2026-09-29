// /app/[org]/books (F-11, 09 sections 1 and 3; step 2.5): an accountant's books of an org where they
// hold a viewing key: the server loads the grants of the scope banner and the metadata of exactly the
// payments the accountant holds a record of (readBooks); the records themselves open in the tab. Only
// for an accountant of the org; one whose keys were revoked or expired reads that nothing is shared.
import { Card, PageHeader } from "@sotto/ui";
import { notFound, redirect } from "next/navigation";
import { accountantNav } from "../../../../lib/org-nav.ts";
import { readBooks, type BooksView } from "../../../../lib/server/books.ts";
import { currentSession } from "../../../../lib/server/current-session.ts";
import { getDb } from "../../../../lib/server/db.ts";
import { ApiError } from "../../../../lib/server/errors.ts";
import { loadMe } from "../../../../lib/server/me.ts";
import { loadNetworkView } from "../../../../lib/server/network-view.ts";
import { AppShell } from "../../_components/app-shell.tsx";
import { BooksPanel } from "./books-panel.tsx";

export const dynamic = "force-dynamic";

export default async function BooksPage({ params }: { params: Promise<{ org: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/app/sign-in");
  const { org: orgId } = await params;
  const db = getDb();
  const me = await loadMe(db, session);
  const membership = me.memberships.find((m) => m.orgId === orgId && m.role === "accountant");
  if (!membership) notFound();
  const network = await loadNetworkView();
  let books: BooksView | null = null;
  let problem: string | null = null;
  try {
    books = await readBooks(db, session, orgId);
  } catch (error) {
    // No active viewing key here, or the org is not active: said in words.
    if (!(error instanceof ApiError) || error.status !== 403) throw error;
    problem = error.message;
  }
  return (
    <AppShell me={me} network={network.label} nav={accountantNav(orgId)}>
      {books && network.available ? (
        <BooksPanel wallet={me.user.wallet} you={session.userId} books={books} network={network} />
      ) : (
        <>
          <PageHeader overline={`${membership.orgName}, read only`} title="Books" />
          <Card>
            <p role="status" data-testid="books-unavailable">
              {problem ??
                "Sotto runs on devnet only during the beta, so the books are not available on this network."}
            </p>
          </Card>
        </>
      )}
    </AppShell>
  );
}
