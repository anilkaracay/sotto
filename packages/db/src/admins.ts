// Admins seed (X-53): the admins table is the source of truth; ADMIN_WALLETS (comma separated base58)
// is used only by this seed to insert rows. Existing rows are kept.
import { isAddress } from "@solana/kit";
import type { Database } from "./client.ts";
import { admins } from "./schema.ts";

export function parseAdminWallets(value: string | undefined): string[] {
  const wallets = (value ?? "")
    .split(",")
    .map((wallet) => wallet.trim())
    .filter((wallet) => wallet.length > 0);
  const invalid = wallets.filter((wallet) => !isAddress(wallet));
  if (invalid.length > 0) {
    throw new Error(`ADMIN_WALLETS holds ${invalid.length} value(s) that are not Solana addresses`);
  }
  return [...new Set(wallets)];
}

/** Inserts the wallets that are not admins yet and returns how many rows were added. */
export async function seedAdmins(db: Database, wallets: readonly string[]): Promise<number> {
  if (wallets.length === 0) return 0;
  const inserted = await db
    .insert(admins)
    .values(wallets.map((wallet) => ({ wallet })))
    .onConflictDoNothing()
    .returning({ wallet: admins.wallet });
  return inserted.length;
}
