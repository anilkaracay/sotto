// pnpm --filter @sotto/db seed:admins: inserts the wallets of ADMIN_WALLETS into admins.
import { parseAdminWallets, seedAdmins } from "../admins.ts";
import { createDb } from "../client.ts";
import { loadDbEnv, requireDatabaseUrl } from "../env.ts";

loadDbEnv();
let close: (() => Promise<void>) | undefined;
try {
  const wallets = parseAdminWallets(process.env.ADMIN_WALLETS);
  const client = createDb(requireDatabaseUrl(), { max: 1 });
  close = client.close;
  const added = await seedAdmins(client.db, wallets);
  console.log(`admins seeded: ${added} added, ${wallets.length - added} already present`);
} catch (error) {
  console.error(
    `error: ${error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/g, "<database-url>") : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  await close?.();
}
