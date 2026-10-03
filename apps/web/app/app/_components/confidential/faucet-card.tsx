"use client";

// The devUSD faucet on the setup page (step 4.3, D-29; founder, 2026-10-02): shown only to a devUSD
// organization on devnet, where the faucet runs. The owner asks for devUSD to their own wallet, at most
// 10,000 devUSD in 24 hours; Sotto's worker mints it, and the card follows the request until it is
// minted, then reads the balances again so the public devUSD can be funded into the account.
import { formatTokenAmount, parseTokenAmount } from "@sotto/sdk/confidential/public";
import { Button, Card } from "@sotto/ui";
import { useCallback, useEffect, useId, useState } from "react";
import { ApiCallError, callApi } from "../../../../lib/client/api.ts";
import type { FaucetMintView, FaucetView } from "../../../../lib/server/faucet.ts";
import { DevnetTestBadge } from "../devnet-badge.tsx";
import { Amount } from "../privacy.tsx";
import styles from "./cards.module.css";
import extra from "./confidential.module.css";
import { useConfidential } from "./context.tsx";

const DECIMALS = 6;
const OPEN: readonly FaucetMintView["status"][] = ["pending", "sent"];

/** The faucet's state for the owner's wallet, or why it could not be read. */
async function fetchFaucet(orgId: string): Promise<FaucetView | string> {
  try {
    return (await callApi<{ faucet: FaucetView }>(`/api/orgs/${orgId}/faucet`)).faucet;
  } catch (error) {
    return error instanceof ApiCallError ? error.message : "The faucet could not be read.";
  }
}

export function FaucetCard() {
  const { orgId, network, refresh } = useConfidential();
  const inputId = useId();
  const [faucet, setFaucet] = useState<FaucetView | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await fetchFaucet(orgId);
    if (typeof next === "string") setProblem(next);
    else {
      setFaucet(next);
      setProblem(null);
    }
    return typeof next === "string" ? null : next;
  }, [orgId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await fetchFaucet(orgId);
      if (cancelled) return;
      if (typeof next === "string") setProblem(next);
      else setFaucet(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  // While a request is open, follow it; once it is minted, read the balances again.
  const open = faucet?.mints.some((mint) => OPEN.includes(mint.status)) ?? false;
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => {
      void load().then((next) => {
        if (next && !next.mints.some((mint) => OPEN.includes(mint.status))) void refresh();
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [open, load, refresh]);

  const remaining = faucet ? BigInt(faucet.remaining) : null;
  const amount = parseTokenAmount(text.trim() || "0", DECIMALS);

  async function ask() {
    if (amount === null || amount <= 0n) return;
    setBusy(true);
    setProblem(null);
    try {
      await callApi(`/api/orgs/${orgId}/faucet`, {
        method: "POST",
        body: { amount: formatTokenAmount(amount, DECIMALS) },
      });
      setText("");
      await load();
    } catch (error) {
      setProblem(error instanceof ApiCallError ? error.message : "The faucet did not answer.");
    } finally {
      setBusy(false);
    }
  }

  // The 24 hour limit, said before the server has to refuse (it refuses too: 429 faucet_limit).
  const overLimit =
    remaining !== null && !open && (remaining === 0n || (amount !== null && amount > remaining));
  const latest = faucet?.mints[0] ?? null;
  return (
    <Card data-testid="faucet-card">
      <div className={styles.head}>
        <h2 className={styles.cardTitle}>Get {network.asset.symbol}</h2>
        <DevnetTestBadge asset={network.asset} />
      </div>
      <p className={styles.lead}>
        {network.asset.symbol} is a test token for trying Sotto on devnet. It has no value. Your
        wallet can get up to 10,000 {network.asset.symbol} every 24 hours, to its public balance;
        then fund your account with it.
      </p>
      {remaining !== null ? (
        <p className={styles.lead} data-testid="faucet-remaining">
          Left for your wallet now:{" "}
          <Amount>
            {formatTokenAmount(remaining, DECIMALS)} {network.asset.symbol}
          </Amount>
        </p>
      ) : null}
      <label className={extra.field} htmlFor={inputId}>
        Amount of {network.asset.symbol}
        <span className={extra.amountRow}>
          <input
            id={inputId}
            className={extra.input}
            inputMode="decimal"
            data-amount=""
            autoComplete="off"
            placeholder="10000"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </span>
      </label>
      {overLimit ? (
        <div className={extra.note} role="status" data-testid="faucet-limit">
          A wallet can get at most 10,000 {network.asset.symbol} in 24 hours;{" "}
          <Amount>
            {formatTokenAmount(remaining ?? 0n, DECIMALS)} {network.asset.symbol}
          </Amount>{" "}
          is left for yours now.
        </div>
      ) : null}
      <div className={styles.actions}>
        <Button
          variant="blue"
          disabled={
            busy || open || amount === null || amount <= 0n || remaining === null || overLimit
          }
          onClick={() => void ask()}
        >
          {open ? "Minting…" : `Get ${network.asset.symbol}`}
        </Button>
      </div>
      {latest ? (
        <p className={extra.note} role="status" data-testid="faucet-latest">
          {latest.status === "minted" ? (
            <>
              Minted{" "}
              <Amount>
                {formatTokenAmount(BigInt(latest.amount), DECIMALS)} {network.asset.symbol}
              </Amount>{" "}
              to your wallet
              {latest.signature ? (
                <>
                  {" "}
                  (transaction <span className="mono">{latest.signature.slice(0, 12)}…</span>)
                </>
              ) : null}
              .
            </>
          ) : latest.status === "failed" ? (
            "The last request could not be minted, so it does not count toward your limit."
          ) : (
            "Sotto is minting your request. This takes about half a minute."
          )}
        </p>
      ) : null}
      {problem ? (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      ) : null}
    </Card>
  );
}
