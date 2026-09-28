// Sanctions screening (D-10, AC-06.2, 08 section 3; step 1.9). Every recipient wallet is screened
// before a payment is authorized, and a clear result counts for 24 hours. D-10 is a BLOCKER for
// mainnet payments: until the founder chooses a provider, devnet and localnet use the local deny list
// (screening-denylist.ts), and on mainnet, or with a provider Sotto has not built, screening answers
// "error", so nothing is authorized. Every result is stored in `screenings`; a hit is logged as an
// event (the wallet is public, no amount).
import { screenings, type Database } from "@sotto/db";
import { and, desc, eq, gt } from "drizzle-orm";
import { log } from "./log.ts";
import { DENYLIST } from "./screening-denylist.ts";

export const SCREENING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type ScreeningResult = "clear" | "hit" | "error";
export type ScreeningProvider = "denylist" | "none";

type Env = Readonly<Record<string, string | undefined>>;

/** D-10: the deny list off mainnet (SCREENING_PROVIDER unset or "denylist"); nothing else yet. */
export function screeningProvider(
  cluster: "localnet" | "devnet" | "mainnet",
  env: Env = process.env,
): ScreeningProvider {
  const configured = env.SCREENING_PROVIDER?.trim() ?? "";
  if (cluster === "mainnet") return "none";
  return configured === "" || configured === "denylist" ? "denylist" : "none";
}

/** Screens one wallet now and stores the result. */
export async function screenWallet(
  db: Database,
  orgId: string,
  wallet: string,
  provider: ScreeningProvider,
): Promise<ScreeningResult> {
  const result: ScreeningResult =
    provider === "none"
      ? "error"
      : DENYLIST.some((entry) => entry.address === wallet)
        ? "hit"
        : "clear";
  await db.insert(screenings).values({ orgId, wallet, provider, result });
  if (result === "hit") log("warn", "screening_hit", { orgId, wallet, provider });
  return result;
}

/** The newest result within 24 hours, or null. */
export async function recentScreening(
  db: Database,
  orgId: string,
  wallet: string,
  now = new Date(),
): Promise<ScreeningResult | null> {
  const [row] = await db
    .select({ result: screenings.result })
    .from(screenings)
    .where(
      and(
        eq(screenings.orgId, orgId),
        eq(screenings.wallet, wallet),
        gt(screenings.createdAt, new Date(now.getTime() - SCREENING_MAX_AGE_MS)),
      ),
    )
    .orderBy(desc(screenings.createdAt))
    .limit(1);
  return row?.result ?? null;
}
