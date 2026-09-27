// /app/admin (D-09, 09 section 1): the Sotto admins' business review. Anyone who is not in the admins
// table gets the 404 page, so the console's existence is not advertised. Approve, reject and suspend
// call the admin API; the worker then issues or closes the attestation (AC-02.3, AC-02.4).
import { notFound, redirect } from "next/navigation";
import { currentSession } from "../../../lib/server/current-session.ts";
import { getDb } from "../../../lib/server/db.ts";
import { loadMe } from "../../../lib/server/me.ts";
import { listOrgsForAdmin } from "../../../lib/server/orgs.ts";
import { networkLabel } from "../../../lib/network.ts";
import { AppShell } from "../_components/app-shell.tsx";
import { AdminConsole } from "./admin-console.tsx";
import { FILTERS, type Filter } from "./filters.ts";

export const dynamic = "force-dynamic";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await currentSession();
  if (!session) redirect("/app/sign-in");
  const db = getDb();
  const me = await loadMe(db, session);
  if (!me.isAdmin) notFound();
  const requested = (await searchParams).status;
  const filter: Filter = FILTERS.find((item) => item === requested) ?? "pending_review";
  const { orgs, truncated } = await listOrgsForAdmin(db, filter === "all" ? null : filter);
  return (
    <AppShell me={me} network={networkLabel(process.env.NEXT_PUBLIC_CLUSTER)}>
      <AdminConsole
        filter={filter}
        truncated={truncated}
        orgs={orgs.map((org) => ({
          id: org.id,
          displayName: org.displayName,
          legalName: org.legalName,
          country: org.country,
          registrationNo: org.registrationNo,
          website: org.website,
          contactEmail: org.contactEmail,
          status: org.status,
          ownerWallet: org.ownerWallet,
          attestationAddress: org.attestationAddress,
          createdAt: org.createdAt.toISOString(),
        }))}
      />
    </AppShell>
  );
}
