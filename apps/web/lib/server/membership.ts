// Row access (08 section 2): every query that reads org data goes through requireMembership. A caller
// without an active membership in one of the roles gets 403, whether or not the org exists.
import { memberships, membershipRole, type Database } from "@sotto/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { apiErrors } from "./errors.ts";
import type { Session } from "./session.ts";

export type Role = (typeof membershipRole.enumValues)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function requireMembership(
  db: Database,
  session: Session | null,
  orgId: string,
  roles: readonly Role[],
): Promise<{ roles: Role[] }> {
  if (!session) throw apiErrors.unauthenticated();
  if (!UUID.test(orgId) || roles.length === 0) throw apiErrors.forbidden();
  const rows = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.orgId, orgId),
        eq(memberships.userId, session.userId),
        isNull(memberships.removedAt),
        inArray(memberships.role, [...roles]),
      ),
    );
  if (rows.length === 0) throw apiErrors.forbidden();
  return { roles: rows.map((row) => row.role) };
}
