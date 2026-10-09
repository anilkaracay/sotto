// The faucet's devnet SOL (step 4.6, D-31): a signed in wallet that holds almost no SOL gets a little
// for network fees and account rent, so trying Sotto on devnet needs no outside faucet. Devnet only
// (the configured cluster is devnet and the RPC serves devnet's genesis hash, as for devUSD). One
// grant per wallet per 24 hours, only while the wallet holds less than the ceiling, and a total for
// all wallets per 24 hours. The web checks and queues; the worker, which holds the paying key, sends
// the transfer (apps/worker/src/jobs/sol-faucet.ts) and checks the ledger again. The lamports are
// Sotto's own and the transfer is public onchain.
import { solGrants, type Database } from "@sotto/db";
import { GENESIS_HASHES } from "@sotto/sdk/cluster";
import type { SolanaRpc } from "@sotto/sdk/tx";
import type { Address } from "@solana/kit";
import { and, desc, eq, gt, ne, sql } from "drizzle-orm";
import type { ServerCluster } from "./cluster.ts";
import { ApiError, apiErrors } from "./errors.ts";
import { log } from "./log.ts";
import type { Session } from "./session.ts";

/** One grant: 0.05 SOL, what an owner's first account, funding, payments and a proof need on devnet. */
export const SOL_GRANT_LAMPORTS = 50_000_000n;
/** A wallet gets a grant only while it holds less than 0.02 SOL. */
export const SOL_BALANCE_CEILING_LAMPORTS = 20_000_000n;
export const SOL_GRANT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** All wallets together: 1 SOL per 24 hours, 20 grants. */
export const SOL_DAILY_TOTAL_LAMPORTS = 1_000_000_000n;
/** Where devnet SOL comes from when the faucet has none left to give. */
export const PUBLIC_SOL_FAUCET = "https://faucet.solana.com";

export const solFaucetErrors = {
  wrongCluster: () =>
    new ApiError(403, "sol_faucet_devnet_only", "The SOL faucet runs on devnet only"),
  networkUnreachable: () =>
    new ApiError(
      503,
      "sol_faucet_network_unreachable",
      "The network could not be reached. Try again.",
    ),
  walletLimit: () =>
    new ApiError(429, "sol_faucet_limit", "A wallet can get devnet SOL once in 24 hours"),
  notNeeded: () =>
    new ApiError(
      409,
      "sol_faucet_not_needed",
      "Your wallet already holds enough SOL for fees, so the faucet keeps its SOL for wallets that have none",
    ),
  dailyTotal: () =>
    new ApiError(
      429,
      "sol_faucet_daily_total",
      `The faucet has given out its SOL for today. Get devnet SOL at ${PUBLIC_SOL_FAUCET} or try again tomorrow`,
    ),
};

export type SolGrantView = {
  id: string;
  lamports: string;
  status: "pending" | "sent" | "paid" | "failed";
  signature: string | null;
  createdAt: string;
};

export type SolFaucetView = {
  wallet: string;
  /** What one grant gives and the balance under which a wallet may ask, in lamports. */
  grantLamports: string;
  ceilingLamports: string;
  /** The wallet's SOL balance, read from chain now. */
  balanceLamports: string;
  /** Whether the wallet may ask now, and if not, why. */
  state: "available" | "used" | "not_needed" | "daily_total";
  /** When the wallet may ask again after a grant, or null. */
  nextAt: string | null;
  grants: SolGrantView[];
};

/** The SOL faucet runs only on a devnet configuration whose RPC serves devnet's genesis hash. */
export async function requireSolFaucetCluster(
  cluster: ServerCluster | null,
  rpc: () => SolanaRpc,
): Promise<void> {
  if (!cluster || cluster.config.name !== "devnet") throw solFaucetErrors.wrongCluster();
  let genesisHash: string;
  try {
    genesisHash = await rpc().getGenesisHash().send();
  } catch {
    throw solFaucetErrors.networkUnreachable();
  }
  if (genesisHash !== GENESIS_HASHES.devnet) throw solFaucetErrors.wrongCluster();
}

async function balanceOf(rpc: () => SolanaRpc, wallet: string): Promise<bigint> {
  try {
    // A session's wallet is an address: sign in verified its signature.
    return (
      await rpc()
        .getBalance(wallet as Address, { commitment: "confirmed" })
        .send()
    ).value;
  } catch {
    throw solFaucetErrors.networkUnreachable();
  }
}

type Reader = Pick<Database, "select">;

/** The wallet's latest grant in the 24 hours before `now` that did not fail, if any. */
async function grantInWindow(db: Reader, wallet: string, now: Date) {
  const [row] = await db
    .select({ createdAt: solGrants.createdAt })
    .from(solGrants)
    .where(
      and(
        eq(solGrants.wallet, wallet),
        gt(solGrants.createdAt, new Date(now.getTime() - SOL_GRANT_WINDOW_MS)),
        ne(solGrants.status, "failed"),
      ),
    )
    .orderBy(desc(solGrants.createdAt))
    .limit(1);
  return row ?? null;
}

/** What all wallets together got in the 24 hours before `now`, failed grants left out. */
async function totalInWindow(db: Reader, now: Date): Promise<bigint> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${solGrants.lamports}), 0)::text` })
    .from(solGrants)
    .where(
      and(
        gt(solGrants.createdAt, new Date(now.getTime() - SOL_GRANT_WINDOW_MS)),
        ne(solGrants.status, "failed"),
      ),
    );
  return BigInt(row?.total ?? "0");
}

const view = (row: typeof solGrants.$inferSelect): SolGrantView => ({
  id: row.id,
  lamports: row.lamports.toString(),
  status: row.status,
  signature: row.signature,
  createdAt: row.createdAt.toISOString(),
});

export async function readSolFaucet(
  db: Database,
  session: Session | null,
  cluster: ServerCluster | null,
  rpc: () => SolanaRpc,
  now = new Date(),
): Promise<SolFaucetView> {
  if (!session) throw apiErrors.unauthenticated();
  await requireSolFaucetCluster(cluster, rpc);
  const [balance, recent, total, rows] = await Promise.all([
    balanceOf(rpc, session.wallet),
    grantInWindow(db, session.wallet, now),
    totalInWindow(db, now),
    db
      .select()
      .from(solGrants)
      .where(eq(solGrants.wallet, session.wallet))
      .orderBy(desc(solGrants.createdAt))
      .limit(3),
  ]);
  const state = recent
    ? "used"
    : balance >= SOL_BALANCE_CEILING_LAMPORTS
      ? "not_needed"
      : total + SOL_GRANT_LAMPORTS > SOL_DAILY_TOTAL_LAMPORTS
        ? "daily_total"
        : "available";
  return {
    wallet: session.wallet,
    grantLamports: SOL_GRANT_LAMPORTS.toString(),
    ceilingLamports: SOL_BALANCE_CEILING_LAMPORTS.toString(),
    balanceLamports: balance.toString(),
    state,
    nextAt: recent
      ? new Date(recent.createdAt.getTime() + SOL_GRANT_WINDOW_MS).toISOString()
      : null,
    grants: rows.map(view),
  };
}

/**
 * Queues one grant to the session's wallet. The wallet's balance is read from chain first; the
 * wallet's and the day's limits are checked and the grant stored under one lock, so requests at once
 * never pass a limit together.
 */
export async function requestSolGrant(
  db: Database,
  session: Session | null,
  cluster: ServerCluster | null,
  rpc: () => SolanaRpc,
  now = new Date(),
): Promise<SolGrantView> {
  if (!session) throw apiErrors.unauthenticated();
  await requireSolFaucetCluster(cluster, rpc);
  if ((await balanceOf(rpc, session.wallet)) >= SOL_BALANCE_CEILING_LAMPORTS) {
    throw solFaucetErrors.notNeeded();
  }
  const row = await db.transaction(async (tx) => {
    // One lock for the faucet: the day's total is shared by every wallet.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sol-faucet'))`);
    if (await grantInWindow(tx, session.wallet, now)) throw solFaucetErrors.walletLimit();
    if ((await totalInWindow(tx, now)) + SOL_GRANT_LAMPORTS > SOL_DAILY_TOTAL_LAMPORTS) {
      throw solFaucetErrors.dailyTotal();
    }
    const [inserted] = await tx
      .insert(solGrants)
      .values({
        userId: session.userId,
        wallet: session.wallet,
        lamports: SOL_GRANT_LAMPORTS,
        createdAt: now,
      })
      .returning();
    if (!inserted) throw new Error("sol grant insert returned no row");
    return inserted;
  });
  log("info", "sol_faucet_requested", { wallet: session.wallet, grantId: row.id });
  return view(row);
}
