// pnpm --filter @sotto/db remove:admins <wallet>...: deletes those wallets from admins, for an admin
// added through ADMIN_WALLETS for one run only (step 3.11, the devnet acceptance run). The seed never
// deletes, so this is the way back.
import { parseAdminWallets, removeAdmins } from "../admins.ts";
import { createDb } from "../client.ts";
import { loadDbEnv, requireDatabaseUrl } from "../env.ts";

loadDbEnv();
let close: (() => Promise<void>) | undefined;
try {
  const wallets = parseAdminWallets(process.argv.slice(2).join(","));
  if (wallets.length === 0) throw new Error("name the wallets to remove");
  const client = createDb(requireDatabaseUrl(), { max: 1 });
  close = client.close;
  const removed = await removeAdmins(client.db, wallets);
  console.log(`admins removed: ${removed} of ${wallets.length}`);
} catch (error) {
  console.error(
    `error: ${error instanceof Error ? error.message.replace(/postgres(ql)?:\/\/\S+/g, "<database-url>") : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  await close?.();
}
