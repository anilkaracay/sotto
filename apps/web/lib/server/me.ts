// The signed in user's view: profile, active memberships with their orgs (the org and role switcher,
// 09 section 1) and whether the wallet is a Sotto admin (the admins table, X-53).
import { admins, memberships, orgs, users, type Database } from "@sotto/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { Role } from "./membership.ts";
import type { Session } from "./session.ts";

export type MembershipView = {
  orgId: string;
  orgName: string;
  orgStatus: "pending_review" | "active" | "suspended";
  role: Role;
};

export type MeView = {
  user: { id: string; wallet: string; displayName: string | null };
  memberships: MembershipView[];
  isAdmin: boolean;
};

export async function loadMe(db: Database, session: Session): Promise<MeView> {
  const [user] = await db
    .select({ id: users.id, wallet: users.wallet, displayName: users.displayName })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);
  if (!user) throw new Error("session user not found");
  const rows = await db
    .select({
      orgId: orgs.id,
      orgName: orgs.displayName,
      orgStatus: orgs.status,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(orgs, eq(orgs.id, memberships.orgId))
    .where(and(eq(memberships.userId, session.userId), isNull(memberships.removedAt)))
    .orderBy(asc(orgs.displayName), asc(memberships.role));
  const [admin] = await db
    .select({ wallet: admins.wallet })
    .from(admins)
    .where(eq(admins.wallet, user.wallet))
    .limit(1);
  return { user, memberships: rows, isAdmin: Boolean(admin) };
}
