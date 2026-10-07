// The balance cards (AC-03.4, AC-03.5, AC-05.1): the confidential available and pending balances,
// decrypted in this tab for the owner only, and the public wUSDC and USDC balances read from chain
// (step 4.3: in the organization's asset's words, wdevUSD and devUSD for devUSD, with its badge).
// Locked keys show Locked, never a number; an account that does not exist says so instead of showing
// zero; wUSDC amounts carry the "devnet test wrap" label (D-01). Presentational only: the
// values come from chain reads (context.tsx), never from local arithmetic (AC-04.4).
import { formatTokenAmount } from "@sotto/sdk/confidential/public";
import { Amount } from "../privacy.tsx";
import type { PublicTokenBalance, TokenAccountState } from "@sotto/sdk/confidential/public";
import { Chip } from "@sotto/ui";
import type { AssetWords } from "../../../../lib/asset-words.ts";
import { DevnetTestBadge } from "../devnet-badge.tsx";
import type { ConfidentialView } from "./context.tsx";
import styles from "./confidential.module.css";

export type CardValue =
  | { state: "amount"; text: string }
  | { state: "locked" }
  | { state: "absent"; text: string }
  | { state: "unavailable"; text: string }
  | { state: "loading" };

export type BalanceCardsProps = {
  asset: AssetWords;
  decimals: number;
  wrapLabel: string;
  /** A read is in flight; values shown are the last ones read. */
  loading: boolean;
  error: string | null;
  confidential: ConfidentialView;
  wusdc: TokenAccountState | null;
  usdc: PublicTokenBalance | null;
};

export function confidentialValue(
  view: ConfidentialView,
  part: "available" | "pending",
  decimals: number,
): CardValue {
  switch (view.kind) {
    case "locked":
      return view.configured ? { state: "locked" } : { state: "absent", text: "Not set up yet" };
    case "not_set_up":
      return { state: "absent", text: "Not set up yet" };
    case "unreadable":
      return { state: "unavailable", text: "Your keys cannot read this account" };
    case "decrypted":
      return { state: "amount", text: formatTokenAmount(view[part], decimals) };
  }
}

export function publicWusdcValue(
  state: TokenAccountState | null,
  decimals: number,
  asset: AssetWords,
): CardValue {
  if (!state) return { state: "loading" };
  if (state.status === "missing") return { state: "absent", text: "No account yet" };
  if (state.status === "other_program") {
    return { state: "unavailable", text: `Not a ${asset.wrappedSymbol} account` };
  }
  return { state: "amount", text: formatTokenAmount(state.amount, decimals) };
}

export function publicUsdcValue(
  balance: PublicTokenBalance | null,
  decimals: number,
  asset: AssetWords,
): CardValue {
  if (!balance) return { state: "loading" };
  if (balance.status === "missing") {
    return { state: "absent", text: `No ${asset.symbol} account` };
  }
  if (balance.status === "invalid") {
    return { state: "unavailable", text: `Not a ${asset.symbol} account` };
  }
  return { state: "amount", text: formatTokenAmount(balance.amount, decimals) };
}

function BalanceCard({
  testId,
  label,
  note,
  unit,
  wrapLabel,
  value,
}: {
  testId: string;
  label: string;
  note: string;
  unit: string;
  wrapLabel: string | null;
  value: CardValue;
}) {
  return (
    <div className={styles.balanceCard} data-testid={testId} data-state={value.state}>
      <div className={styles.balanceHead}>
        <span className={styles.balanceLabel}>{label}</span>
        {value.state === "locked" ? <Chip tone="amber">Locked</Chip> : null}
      </div>
      <div className={styles.figure} data-testid={`${testId}-value`}>
        {value.state === "amount" ? (
          <>
            <Amount>
              <b className="num">{value.text}</b> <span className={styles.unit}>{unit}</span>
            </Amount>
          </>
        ) : value.state === "locked" ? (
          <span className={styles.muted}>Unlock to see</span>
        ) : value.state === "loading" ? (
          <span className={styles.skeleton} aria-label="Loading" />
        ) : (
          <span className={styles.muted}>{value.text}</span>
        )}
      </div>
      {wrapLabel ? (
        <span className={styles.wrapTag} data-testid="wrap-label">
          {wrapLabel}
        </span>
      ) : null}
      <p className={styles.balanceNote}>{note}</p>
    </div>
  );
}

export function BalanceCards(props: BalanceCardsProps) {
  const { asset, decimals, wrapLabel, confidential } = props;
  return (
    <section className={styles.balances} aria-label="Balances" data-testid="balances">
      <div className={styles.balancesHead}>
        <span className={styles.balancesTitle}>
          <h2 className={styles.sectionTitle}>Balances</h2>
          <DevnetTestBadge asset={asset} />
        </span>
        <span className={styles.status} role="status">
          {props.error ?? (props.loading ? "Reading from the network…" : "Read from the network")}
        </span>
      </div>
      <div className={styles.balanceGrid}>
        <BalanceCard
          testId="balance-available"
          label="Available"
          note="Confidential, decrypted in this tab"
          unit={asset.wrappedSymbol}
          wrapLabel={wrapLabel}
          value={confidentialValue(confidential, "available", decimals)}
        />
        <BalanceCard
          testId="balance-pending"
          label="Pending"
          note="Confidential, waiting to be applied"
          unit={asset.wrappedSymbol}
          wrapLabel={wrapLabel}
          value={confidentialValue(confidential, "pending", decimals)}
        />
        <BalanceCard
          testId="balance-public-wusdc"
          label={`Public ${asset.wrappedSymbol}`}
          note="Visible to anyone onchain"
          unit={asset.wrappedSymbol}
          wrapLabel={wrapLabel}
          value={publicWusdcValue(props.wusdc, decimals, asset)}
        />
        <BalanceCard
          testId="balance-public-usdc"
          label={`Public ${asset.symbol}`}
          note="Visible to anyone onchain"
          unit={asset.symbol}
          wrapLabel={null}
          value={publicUsdcValue(props.usdc, decimals, asset)}
        />
      </div>
    </section>
  );
}
