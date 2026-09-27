"use client";

// The balance cards fed by the confidential session (context.tsx): chain reads through /api/rpc and
// the values the worker decrypted in this tab (AC-03.4, AC-03.5, AC-05.1).
import { BalanceCards } from "./balances.tsx";
import { useConfidential } from "./context.tsx";

export function BalancesSection() {
  const { network, ready, data } = useConfidential();
  if (!ready) return null;
  return (
    <BalanceCards
      decimals={network.decimals ?? 6}
      wrapLabel={network.wrapLabel}
      loading={data.loading}
      error={data.error}
      confidential={data.confidential}
      wusdc={data.wusdc}
      usdc={data.usdc}
    />
  );
}
