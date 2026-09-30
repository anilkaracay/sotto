"use client";

// What the chain shows (AC-05.3, 09 section 3; step 2.5; no approved design, 13 A44): the org's recent
// onchain activity from chain_activity only (GET /orgs/:id/chain-activity), which the worker indexes
// from finalized transactions: when, what, which accounts, and an amount only where the chain shows
// one. A confidential transfer's amount is sealed; the panel says so and never shows a number for it.
import { Button, Card, Chip, Table, Td, Th } from "@sotto/ui";
import { useEffect, useState } from "react";
import { chainAmountWords, CHAIN_TYPE_WORDS } from "../../../../lib/chain-activity.ts";
import { callApi } from "../../../../lib/client/api.ts";
import { WithAmounts } from "../../_components/privacy.tsx";
import { formatDate, shortWallet } from "../../../../lib/format.ts";
import type { ChainActivityView } from "../../../../lib/server/chain-activity.ts";
import cards from "../../_components/confidential/cards.module.css";
import { useConfidential } from "../../_components/confidential/context.tsx";
import styles from "./overview.module.css";

const SHOWN = 8;

export type ChainState =
  { kind: "loading" } | { kind: "error" } | { kind: "loaded"; activity: ChainActivityView[] };

export function ChainPanel() {
  const { orgId, network } = useConfidential();
  const [state, setState] = useState<ChainState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void callApi<{ activity: ChainActivityView[] }>(
      `/api/orgs/${orgId}/chain-activity?limit=${SHOWN}`,
    ).then(
      ({ activity }) => {
        if (!cancelled) setState({ kind: "loaded", activity });
      },
      () => {
        if (!cancelled) setState({ kind: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [orgId, attempt]);
  return (
    <ChainView
      state={state}
      wrapLabel={network.wrapLabel}
      onRetry={() => {
        setState({ kind: "loading" });
        setAttempt((value) => value + 1);
      }}
    />
  );
}

/** The accounts of a row: the org's, and for a transfer the other one, with its direction. */
function accounts(row: ChainActivityView): string {
  const own = shortWallet(row.tokenAccount);
  if (!row.counterparty) return own;
  const other = shortWallet(row.counterparty);
  return row.type.endsWith("_in") ? `${other} → ${own}` : `${own} → ${other}`;
}

/**
 * A glyph per kind of event (design pass C, step 3.6, 13 A44): out and in as arrows, the confidential
 * steps with the design's lock, wraps as the swap, a sealed transfer in blue, a public one in grey.
 */
const KIND_ICON: Record<ChainActivityView["type"], { path: string; tone: "blue" | "grey" }> = {
  account_setup: { path: "M6 11V8a6 6 0 0112 0v3M5 11h14v10H5z", tone: "blue" },
  deposit: { path: "M12 5v14M5 12h14", tone: "blue" },
  apply_pending: { path: "M5 12l5 5L20 7", tone: "blue" },
  transfer_out: { path: "M7 17L17 7M9 7h8v8", tone: "blue" },
  transfer_in: { path: "M17 7L7 17M15 17H7V9", tone: "blue" },
  withdraw: { path: "M5 12h14", tone: "grey" },
  wrap: { path: "M4 8h13l-3-3M20 16H7l3 3", tone: "grey" },
  unwrap: { path: "M20 8H7l3-3M4 16h13l-3 3", tone: "grey" },
  public_transfer_out: { path: "M7 17L17 7M9 7h8v8", tone: "grey" },
  public_transfer_in: { path: "M17 7L7 17M15 17H7V9", tone: "grey" },
};

function KindIcon({ type }: { type: ChainActivityView["type"] }) {
  const icon = KIND_ICON[type];
  return (
    <span
      className={`${styles.kindIcon} ${icon.tone === "grey" ? styles.kindPublic : ""}`}
      aria-hidden="true"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={icon.path} />
      </svg>
    </span>
  );
}

export function ChainView({
  state,
  wrapLabel,
  onRetry,
}: {
  state: ChainState;
  wrapLabel: string;
  onRetry: () => void;
}) {
  return (
    <Card className={styles.wide} data-testid="chain-panel">
      <div className={styles.head}>
        <h2 className={cards.cardTitle}>What the chain shows</h2>
        {state.kind === "loaded" && state.activity.length > 0 ? (
          <small className={styles.muted}>
            {state.activity.length === 1 ? "1 event" : `${state.activity.length} events`}
          </small>
        ) : null}
      </div>
      <p className={cards.lead}>
        Anyone can see this on Solana: the accounts, the times and what happened. Confidential
        amounts stay sealed. wUSDC figures are the {wrapLabel}.
      </p>
      {state.kind === "error" ? (
        <div className={cards.problem} role="alert" data-testid="chain-error">
          <p>What the chain shows could not be loaded. Try again.</p>
          <div className={cards.actions}>
            <Button variant="line" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </div>
      ) : state.kind === "loading" ? (
        <p className={styles.empty} role="status">
          Reading your account&apos;s activity on Solana…
        </p>
      ) : state.activity.length === 0 ? (
        <p className={styles.empty} data-testid="chain-empty">
          Nothing on Solana yet. Your account&apos;s activity appears here a few seconds after it is
          final.
        </p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>What happened</Th>
              <Th>Accounts</Th>
              <Th>Transaction</Th>
              <Th align="right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {state.activity.map((row) => {
              const amount = chainAmountWords(row);
              return (
                <tr key={row.id} data-testid="chain-row" data-type={row.type}>
                  <Td>
                    <span className={`num ${styles.date}`}>
                      {row.blockTime ? formatDate(row.blockTime) : `Slot ${row.slot}`}
                    </span>
                  </Td>
                  <Td>
                    <span className={styles.chainKind}>
                      <KindIcon type={row.type} />
                      {CHAIN_TYPE_WORDS[row.type]}
                    </span>
                  </Td>
                  <Td>
                    <span className="mono">{accounts(row)}</span>
                  </Td>
                  <Td>
                    <span className="mono">{row.signature.slice(0, 8)}…</span>
                  </Td>
                  <Td align="right">
                    {amount.kind === "sealed" ? (
                      <Chip tone="blue" data-testid="chain-amount">
                        {amount.text}
                      </Chip>
                    ) : (
                      <span
                        className={amount.kind === "public" ? "num" : styles.muted}
                        data-testid="chain-amount"
                      >
                        <WithAmounts>{amount.text}</WithAmounts>
                      </span>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
