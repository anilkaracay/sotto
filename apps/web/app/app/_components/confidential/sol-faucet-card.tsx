"use client";

// The faucet's devnet SOL (step 4.6, D-31): shown on devnet, where a new wallet has no SOL for the
// network fees and the rent of its accounts. The signed in wallet asks once; Sotto's worker sends
// 0.05 SOL, and the card follows the request until it is paid, then reads the balances again. The
// card says why when the wallet cannot ask: it got a grant in the last 24 hours, it already holds
// enough, the faucet gave out its total for the day, or its wallet is being refilled.
import { formatTokenAmount } from "@sotto/sdk/confidential/public";
import { Button, Card } from "@sotto/ui";
import { useCallback, useEffect, useState } from "react";
import { ApiCallError, callApi } from "../../../../lib/client/api.ts";
import { explorerUrl } from "../../../../lib/explorer.ts";
import type { SolFaucetView, SolGrantView } from "../../../../lib/server/sol-faucet.ts";
import styles from "./cards.module.css";
import extra from "./confidential.module.css";
import { useConfidential } from "./context.tsx";

const OPEN: readonly SolGrantView["status"][] = ["pending", "sent"];
const sol = (lamports: string) => `${formatTokenAmount(BigInt(lamports), 9)} SOL`;
const when = (iso: string) =>
  `${new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(iso))} UTC`;

async function fetchSolFaucet(): Promise<SolFaucetView | string> {
  try {
    return (await callApi<{ faucet: SolFaucetView }>("/api/faucet/sol")).faucet;
  } catch (error) {
    return error instanceof ApiCallError ? error.message : "The faucet could not be read.";
  }
}

export function SolFaucetCard() {
  const { network, refresh } = useConfidential();
  const [faucet, setFaucet] = useState<SolFaucetView | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await fetchSolFaucet();
    if (typeof next === "string") setProblem(next);
    else {
      setFaucet(next);
      setProblem(null);
    }
    return typeof next === "string" ? null : next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await fetchSolFaucet();
      if (cancelled) return;
      if (typeof next === "string") setProblem(next);
      else setFaucet(next);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // While a grant is open, follow it; once it is paid, read the balances again.
  const open = faucet?.grants.some((grant) => OPEN.includes(grant.status)) ?? false;
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => {
      void load().then((next) => {
        if (next && !next.grants.some((grant) => OPEN.includes(grant.status))) void refresh();
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [open, load, refresh]);

  async function ask() {
    setBusy(true);
    setProblem(null);
    try {
      await callApi("/api/faucet/sol", { method: "POST", body: {} });
      await load();
    } catch (error) {
      setProblem(error instanceof ApiCallError ? error.message : "The faucet did not answer.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  const latest = faucet?.grants[0] ?? null;
  const link =
    latest?.status === "paid" && latest.signature
      ? explorerUrl("tx", latest.signature, network.cluster)
      : null;
  return (
    <Card data-testid="sol-faucet-card">
      <div className={styles.head}>
        <h2 className={styles.cardTitle}>Get devnet SOL</h2>
      </div>
      <p className={styles.lead}>
        SOL pays the network fees and the rent of your wallet&apos;s accounts. On devnet it has no
        value. Sotto gives a wallet {faucet ? sol(faucet.grantLamports) : "0.05 SOL"} once every 24
        hours, while it holds less than {faucet ? sol(faucet.ceilingLamports) : "0.02 SOL"}.
      </p>
      {faucet ? (
        <p className={styles.lead} data-testid="sol-faucet-balance">
          Your wallet holds {sol(faucet.balanceLamports)} now.
        </p>
      ) : null}
      {faucet?.state === "not_needed" ? (
        <div className={extra.note} role="status" data-testid="sol-faucet-state">
          That is enough for fees, so the faucet keeps its SOL for wallets that have none.
        </div>
      ) : null}
      {faucet?.state === "daily_total" ? (
        <div className={extra.note} role="status" data-testid="sol-faucet-state">
          The faucet has given out its SOL for today. Get devnet SOL at{" "}
          <a
            className={styles.link}
            href="https://faucet.solana.com"
            target="_blank"
            rel="noreferrer"
          >
            faucet.solana.com
          </a>
          , or try again tomorrow.
        </div>
      ) : null}
      {faucet?.state === "refilling" ? (
        <div className={extra.note} role="status" data-testid="sol-faucet-state">
          Test SOL is being refilled, try again later.
        </div>
      ) : null}
      {faucet?.state === "used" && !open && faucet.nextAt ? (
        <div className={extra.note} role="status" data-testid="sol-faucet-state">
          Your wallet got its SOL for these 24 hours. It can ask again after {when(faucet.nextAt)}.
        </div>
      ) : null}
      <div className={styles.actions}>
        <Button
          variant="blue"
          disabled={busy || open || faucet?.state !== "available"}
          onClick={() => void ask()}
        >
          {open ? "Sending…" : `Get ${faucet ? sol(faucet.grantLamports) : "0.05 SOL"}`}
        </Button>
      </div>
      {latest ? (
        <p className={extra.note} role="status" data-testid="sol-faucet-latest">
          {latest.status === "paid" ? (
            <>
              Sent {sol(latest.lamports)} to your wallet.
              {link ? (
                <>
                  {" "}
                  <a className={styles.link} href={link} target="_blank" rel="noreferrer">
                    Verify on Solana
                  </a>
                </>
              ) : null}
            </>
          ) : latest.refilling ? (
            "Test SOL is being refilled, try again later. Your request does not count toward your limit."
          ) : latest.status === "failed" ? (
            "The last request could not be sent, so it does not count toward your limit."
          ) : (
            "Sotto is sending your SOL. This takes about half a minute."
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
