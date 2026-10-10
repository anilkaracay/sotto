"use client";

// Balance growth on the overview (AC-05.2, 09 section 3, 07 section 6; step 2.12), on the design's
// dark card with its glowing month bars. When the owner's keys are unlocked here, the tab first saves
// today's balance snapshot if none exists yet (lib/client/balance-snapshot.ts: one manifest signature
// a day), then reads the owner's snapshots, verifies them against the owner's manifests (I-9), opens
// them with the viewing key and adds the public deposits and withdrawals of chain_activity
// (lib/balance-history.ts). Every figure goes through Amount, so the privacy screen blurs it (F-15).
import { Card } from "@sotto/ui";
import { useEffect, useState } from "react";
import {
  balanceHistory,
  HISTORY_MONTHS,
  historySince,
  type BalanceHistory,
  type BalanceSnapshot,
  type PublicFlow,
} from "../../../../lib/balance-history.ts";
import { callApi } from "../../../../lib/client/api.ts";
import {
  saveDailySnapshot,
  type OwnerViewerKey,
  type SnapshotResult,
} from "../../../../lib/client/balance-snapshot.ts";
import { openDisclosures } from "../../../../lib/client/disclosures.ts";
import { formatDate } from "../../../../lib/format.ts";
import type { ChainActivityView } from "../../../../lib/server/chain-activity.ts";
import type { DisclosureItemView, ManifestView } from "../../../../lib/server/disclosures.ts";
import { useConfidential } from "../../_components/confidential/context.tsx";
import { useKeySession } from "../../_components/key-session.tsx";
import { MonthBars } from "../../_components/month-bars.tsx";
import styles from "./overview.module.css";
import { formatWrapped } from "../../../../lib/asset-words.ts";
import { useAssetWords } from "../../_components/asset.tsx";

export type GrowthState =
  | { kind: "locked" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; history: BalanceHistory; unverified: number };

/** Why today's balance is not in the history, when the snapshot could not be saved. */
export const SNAPSHOT_NOTES: Partial<Record<SnapshotResult | "failed", string>> = {
  not_signed:
    "Your wallet did not sign today's balance record, so today is not in the history yet. Sotto asks again the next time you unlock here.",
  key_unverified:
    "Your viewing key did not verify, so today's balance was not recorded. Register your public viewing key again on Account setup.",
  failed: "Today's balance could not be recorded. Sotto tries again the next time you unlock here.",
};

/** The unlocks this tab already tried to save a snapshot for (one attempt per unlock). */
const attempted = new WeakSet<object>();

export function BalanceGrowth({
  userId,
  ownerKey,
}: {
  userId: string;
  ownerKey: OwnerViewerKey | null;
}) {
  const { orgId, wallet, data, vault, connected, network } = useConfidential();
  const currency = network.asset.symbol;
  const { session, viewing } = useKeySession();
  const balance = data.confidential.kind === "decrypted" ? data.confidential : null;
  const unlocked = viewing?.wallet === wallet && balance !== null && vault.unlocked !== null;
  const [state, setState] = useState<GrowthState>({ kind: "locked" });
  const [note, setNote] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // Once the keys lock, nothing here may start the crypto worker again: a lock closes it (AC-03.5),
    // and a read still running must not open a new one. The session's own state says so at once,
    // before React runs this effect's cleanup.
    const locked = () => cancelled || session.unlocked() === null || session.viewing() === null;
    const worker = () => {
      if (locked()) throw new Error("The keys locked.");
      return session.openWorker();
    };
    const openSealed = (ciphertext: Uint8Array) => {
      if (locked()) throw new Error("The keys locked.");
      return session.openWorker().openSealed(ciphertext);
    };
    void (async () => {
      if (!unlocked || !viewing || !balance) {
        if (!cancelled) setState({ kind: "locked" });
        return;
      }
      setState({ kind: "loading" });
      // Today's snapshot first, so the history holds it (at most once per unlock of this tab).
      if (!attempted.has(viewing) && ownerKey && connected) {
        attempted.add(viewing);
        let saved: SnapshotResult | "failed";
        try {
          saved = await saveDailySnapshot({
            orgId,
            currency,
            owner: ownerKey,
            available: balance.available,
            pending: balance.pending,
            now: new Date(),
            sign: (message) => connected.sign(message),
            worker,
          });
        } catch {
          saved = "failed";
        }
        if (!cancelled) setNote(SNAPSHOT_NOTES[saved] ?? null);
      }
      try {
        const now = new Date();
        const since = historySince(now);
        const snapshotsPath = `/api/orgs/${orgId}/disclosures?kind=balance_snapshot`;
        const [recent, older, flows] = await Promise.all([
          callApi<{ items: DisclosureItemView[]; manifests: ManifestView[] }>(
            `${snapshotsPath}&from=${since}`,
          ),
          callApi<{ items: DisclosureItemView[] }>(`${snapshotsPath}&to=${since}&limit=1`),
          callApi<{ activity: ChainActivityView[] }>(
            `/api/orgs/${orgId}/chain-activity?flows=public&since=${since}`,
          ),
        ]);
        const opened = await openDisclosures({
          orgId,
          ownerWallet: wallet,
          viewerUserId: userId,
          items: recent.items,
          manifests: recent.manifests,
          open: openSealed,
        });
        const snapshots: BalanceSnapshot[] = [];
        for (const item of opened) {
          if (item.state !== "opened" || item.payload.pending === undefined) continue;
          snapshots.push({
            day: item.payload.subject,
            at: item.payload.created_at,
            available: BigInt(item.payload.amount),
            pending: BigInt(item.payload.pending),
          });
        }
        const publicFlows: PublicFlow[] = flows.activity.flatMap((row) =>
          row.blockTime && row.publicAmount && (row.type === "deposit" || row.type === "withdraw")
            ? [{ at: row.blockTime, type: row.type, amount: BigInt(row.publicAmount) }]
            : [],
        );
        const history = balanceHistory({
          snapshots,
          flows: publicFlows,
          now,
          startedBefore: older.items.length > 0,
        });
        if (!cancelled) {
          setState({
            kind: "ready",
            history,
            unverified: opened.filter((item) => item.state !== "opened").length,
          });
        }
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
    // The balances decrypted in the tab start the read; a new unlock or a retry reads again.
  }, [
    unlocked,
    viewing,
    balance,
    ownerKey,
    connected,
    orgId,
    currency,
    wallet,
    userId,
    session,
    vault,
    attempt,
  ]);

  return (
    <BalanceGrowthView state={state} note={note} onRetry={() => setAttempt((value) => value + 1)} />
  );
}

/** The card in each state (exported for the component tests). */
export function BalanceGrowthView({
  state,
  note,
  onRetry,
}: {
  state: GrowthState;
  note: string | null;
  onRetry: () => void;
}) {
  const asset = useAssetWords();
  const formatWusdc = (base: bigint) => formatWrapped(base, asset);
  return (
    <Card tone="dark" className={styles.wide} data-testid="balance-growth">
      <div className={styles.darkHead}>
        <h3>Balance growth</h3>
        <span className={styles.darkChip}>Confidential, {asset.wrappedSymbol}</span>
      </div>
      {state.kind === "locked" ? (
        <p className={styles.darkEmpty} data-testid="growth-locked">
          Unlock to see
        </p>
      ) : state.kind === "loading" ? (
        <p className={styles.darkEmpty} role="status">
          Reading your balance history…
        </p>
      ) : state.kind === "error" ? (
        <p className={styles.darkEmpty} role="alert" data-testid="growth-error">
          Your balance history could not be read.{" "}
          <button type="button" className={styles.darkRetry} onClick={onRetry}>
            Try again
          </button>
        </p>
      ) : state.history.kind === "empty" ? (
        <p className={styles.darkEmpty} data-testid="growth-empty">
          No balance history yet. Sotto records your balance once a day when you unlock your keys
          here, encrypted for you only.
        </p>
      ) : (
        <>
          <MonthBars
            totals={state.history.months.map((entry) => ({
              month: entry.month,
              total: entry.balance,
            }))}
            selected={state.history.latest}
            format={formatWusdc}
            testId="growth-bar"
            slots={HISTORY_MONTHS}
          />
          {state.history.startsOn ? (
            <p className={styles.darkNote} data-testid="growth-starts">
              Balance history starts on {formatDate(`${state.history.startsOn}T00:00:00.000Z`)}
            </p>
          ) : null}
        </>
      )}
      {state.kind === "ready" && state.unverified > 0 ? (
        <p className={styles.darkNote} role="status">
          {state.unverified === 1
            ? "1 balance record did not verify against your wallet's signature, so it was not used."
            : `${state.unverified} balance records did not verify against your wallet's signature, so they were not used.`}
        </p>
      ) : null}
      {note ? (
        <p className={styles.darkNote} role="status" data-testid="growth-note">
          {note}
        </p>
      ) : null}
    </Card>
  );
}
