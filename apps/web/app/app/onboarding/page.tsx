// /app/onboarding (F-02, 09 section 1): the organization the signed in user owns. Without one, the
// form to create it (AC-02.1); with one, its verification status: in review (AC-02.2), verified with
// its onchain attestation (AC-02.3) or not verified (AC-02.4).
import { redirect } from "next/navigation";
import { currentSession } from "../../../lib/server/current-session.ts";
import { getDb } from "../../../lib/server/db.ts";
import { loadMe } from "../../../lib/server/me.ts";
import { ownedOrg } from "../../../lib/server/orgs.ts";
import { networkLabel } from "../../../lib/network.ts";
import { AppShell } from "../_components/app-shell.tsx";
import { OrgOnboarding } from "./org-onboarding.tsx";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await currentSession();
  if (!session) redirect("/app/sign-in");
  const db = getDb();
  const [me, org] = await Promise.all([loadMe(db, session), ownedOrg(db, session.userId)]);
  return (
    <AppShell me={me} network={networkLabel(process.env.NEXT_PUBLIC_CLUSTER)}>
      <OrgOnboarding
        org={
          org
            ? {
                ...org,
                reviewedAt: org.reviewedAt?.toISOString() ?? null,
                createdAt: org.createdAt.toISOString(),
              }
            : null
        }
      />
    </AppShell>
  );
}
