// /app/invite/[token] (09 section 1, AC-07.3; step 1.8): accept an invite, register the viewing key and
// configure the account. Before sign in it shows the invite and a sign in link that comes back here;
// after acceptance the same link continues with the recipient's setup. An unknown token is a 404.
import { Chip, PageHeader } from "@sotto/ui";
import { notFound } from "next/navigation";
import { currentSession } from "../../../../lib/server/current-session.ts";
import { getDb } from "../../../../lib/server/db.ts";
import { ApiError } from "../../../../lib/server/errors.ts";
import { readInvite } from "../../../../lib/server/invites.ts";
import { loadMe } from "../../../../lib/server/me.ts";
import { loadNetworkView } from "../../../../lib/server/network-view.ts";
import { readOrgTokenAccount } from "../../../../lib/server/token-accounts.ts";
import { readViewerKey } from "../../../../lib/server/viewer-keys.ts";
import { AppShell } from "../../_components/app-shell.tsx";
import { Logo } from "../../_components/logo.tsx";
import { InvitePanel } from "./invite-panel.tsx";
import styles from "./invite.module.css";
import { AssetWordsProvider } from "../../_components/asset.tsx";
import { DevnetTestBadge } from "../../_components/devnet-badge.tsx";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await currentSession();
  const db = getDb();
  const invite = await readInvite(db, token, session).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  const [me, network] = await Promise.all([
    session ? loadMe(db, session) : Promise.resolve(null),
    loadNetworkView({ orgId: invite.org.id }),
  ]);
  const joined = session !== null && invite.acceptedByYou;
  const [viewerKey, recorded] = await Promise.all([
    joined
      ? readViewerKey(db, session, session.userId).catch((error: unknown) => {
          if (error instanceof ApiError && error.status === 404) return null;
          throw error;
        })
      : Promise.resolve(null),
    joined && network.available
      ? readOrgTokenAccount(db, session.userId, invite.org.id, network.cluster)
      : Promise.resolve(null),
  ]);
  const panel = (
    <InvitePanel
      token={token}
      invite={invite}
      wallet={me?.user.wallet ?? null}
      network={network.available ? network : null}
      viewerKey={
        viewerKey
          ? { publicKey: viewerKey.publicKey, createdAt: viewerKey.createdAt.toISOString() }
          : null
      }
      recorded={
        recorded ? { address: recorded.address, applyFlagged: recorded.applyFlagged } : null
      }
    />
  );
  if (me) {
    return (
      <AppShell me={me} network={network}>
        <PageHeader overline={invite.org.displayName} title="Your invite" />
        {panel}
      </AppShell>
    );
  }
  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <Logo />
        <Chip tone="blue" data-testid="network-label">
          {network.label}
        </Chip>
        <DevnetTestBadge asset={network.asset} />
      </header>
      <main className={styles.body}>
        <PageHeader overline={invite.org.displayName} title="Your invite" />
        <AssetWordsProvider asset={network.asset}>{panel}</AssetWordsProvider>
      </main>
    </div>
  );
}
