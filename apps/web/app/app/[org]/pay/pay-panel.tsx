"use client";

// The recipient's pay page, client part (step 1.10): the balances of the recipient's own wUSDC
// account, the payments received, and withdraw and unwrap (F-09, AC-09.1). A payment received is the
// recipient disclosure of AC-06.4: it is trusted only when its manifest names this org and carries the
// org owner's signature and lists the item for this recipient (I-9), and it opens with the recipient's
// viewing key in this tab. The pending balance can be applied here; withdraw applies it first too.
import { formatTokenAmount } from "@sotto/sdk/confidential/public";
import { Button, Card, Chip, Table, Td, Th } from "@sotto/ui";
import { address, fetchEncodedAccount } from "@solana/kit";
import { useEffect, useState } from "react";
import { callApi } from "../../../../lib/client/api.ts";
import { openDisclosures, type OpenedDisclosure } from "../../../../lib/client/disclosures.ts";
import { browserRpc } from "../../../../lib/client/rpc.ts";
import { formatDate } from "../../../../lib/format.ts";
import { CATEGORY_LABEL, type PaymentCategory } from "../../../../lib/payment.ts";
import type { DisclosureItemView, ManifestView } from "../../../../lib/server/disclosures.ts";
import { BalancesSection } from "../../_components/confidential/balances-section.tsx";
import cards from "../../_components/confidential/cards.module.css";
import extra from "../../_components/confidential/confidential.module.css";
import {
  ConfidentialProvider,
  useConfidential,
  type AvailableNetwork,
} from "../../_components/confidential/context.tsx";
import { KeysCard, WalletCard } from "../../_components/confidential/keys.tsx";
import { NetworkBanner } from "../../_components/confidential/network-banner.tsx";
import { StepError, useSend } from "../../_components/confidential/use-send.ts";
import { WithdrawForm } from "../../_components/confidential/withdraw.tsx";
import { useKeySession } from "../../_components/key-session.tsx";
import styles from "./pay.module.css";

const DECIMALS = 6;

export function PayPanel(props: {
  wallet: string;
  userId: string;
  orgId: string;
  orgName: string;
  ownerWallet: string;
  network: AvailableNetwork;
}) {
  return (
    <ConfidentialProvider wallet={props.wallet} orgId={props.orgId} network={props.network}>
      <div className={cards.grid}>
        <NetworkBanner check={props.network.check} label={props.network.label} />
        <BalancesSection />
        <Received userId={props.userId} orgName={props.orgName} ownerWallet={props.ownerWallet} />
        <Card data-testid="withdraw-card">
          <h2 className={cards.cardTitle}>Withdraw to USDC</h2>
          <ApplyPending />
          <WithdrawForm />
        </Card>
        <div className={styles.side}>
          <WalletCard />
          <KeysCard />
        </div>
      </div>
    </ConfidentialProvider>
  );
}

/** 06 section 4, step 3: a pending balance is applied from fresh account state, with the keys. */
function ApplyPending() {
  const { vault, data, network } = useConfidential();
  const sending = useSend();
  const pending = data.confidential.kind === "decrypted" ? data.confidential.pending : 0n;
  if (pending <= 0n && !sending.done) return null;
  const token = data.wusdcAccount;
  return (
    <div className={styles.apply}>
      {pending > 0n ? (
        <p className={cards.lead}>
          {formatTokenAmount(pending, network.decimals ?? DECIMALS)} wUSDC is in your pending
          balance. Apply it to your available balance to use it.
        </p>
      ) : null}
      {pending > 0n ? (
        <div className={cards.actions}>
          <Button
            variant="line"
            disabled={!sending.canSend || sending.busy !== null || !vault.unlocked || !token}
            onClick={() => {
              if (!token) return;
              void sending.send({
                busy: "Applying your pending balance…",
                done: "Applied your pending balance to your available balance.",
                build: async () => {
                  const account = await fetchEncodedAccount(browserRpc(), address(token), {
                    commitment: "confirmed",
                  });
                  if (!account.exists) throw new StepError("Your wUSDC account does not exist.");
                  return [
                    await vault.worker().applyInstruction(token, new Uint8Array(account.data)),
                  ];
                },
              });
            }}
          >
            Apply pending balance
          </Button>
        </div>
      ) : null}
      {sending.busy ? (
        <div className={extra.done} role="status">
          {sending.busy}
        </div>
      ) : null}
      {sending.done ? (
        <div className={extra.done} role="status" data-testid="apply-done">
          {sending.done.text} Transaction{" "}
          <span className="mono">{sending.done.signature.slice(0, 12)}…</span>
        </div>
      ) : null}
      {sending.problem ? (
        <p className={cards.problem} role="alert">
          {sending.problem}
        </p>
      ) : null}
    </div>
  );
}

type Loaded = { items: DisclosureItemView[]; manifests: ManifestView[] };

function Received({
  userId,
  orgName,
  ownerWallet,
}: {
  userId: string;
  orgName: string;
  ownerWallet: string;
}) {
  const { orgId, wallet, network } = useConfidential();
  const { session, viewing } = useKeySession();
  const unlocked = viewing?.wallet === wallet;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [opened, setOpened] = useState<OpenedDisclosure[] | null>(null);

  // A new attempt (the Try again button) reads everything again.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void callApi<Loaded>(`/api/orgs/${orgId}/disclosures?kind=payment`).then(
      (result) => {
        if (!cancelled) setLoaded(result);
      },
      () => {
        if (!cancelled) setProblem("Your payments could not be loaded. Try again.");
      },
    );
    return () => {
      cancelled = true;
    };
  }, [orgId, attempt]);

  function retry() {
    setProblem(null);
    setLoaded(null);
    setAttempt((value) => value + 1);
  }

  // While the tab holds the viewing key, the payments open for this page only; locked, none stay open.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result =
        loaded && unlocked
          ? await openDisclosures({
              orgId,
              ownerWallet,
              viewerUserId: userId,
              items: loaded.items,
              manifests: loaded.manifests,
              open: (ciphertext) => session.worker().openSealed(ciphertext),
            })
          : null;
      if (!cancelled) setOpened(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, unlocked, session, orgId, ownerWallet, userId]);

  const count = loaded?.items.length ?? 0;
  const newest = (opened ?? []).slice().reverse();
  const unverified = newest.filter((item) => item.state === "unverified").length;

  return (
    <Card className={styles.wide} data-testid="received-card">
      <div className={styles.head}>
        <h2 className={cards.cardTitle}>Payments received</h2>
        {count > 0 ? <small className={styles.muted}>From {orgName}</small> : null}
      </div>
      {problem ? (
        <div className={cards.problem} role="alert">
          <p>{problem}</p>
          <div className={cards.actions}>
            <Button variant="line" size="sm" onClick={retry}>
              Try again
            </Button>
          </div>
        </div>
      ) : !loaded ? (
        <p className={styles.empty} role="status">
          Reading your payments…
        </p>
      ) : count === 0 ? (
        <p className={styles.empty} data-testid="received-empty">
          No payments yet. When {orgName} pays you, the payment and its details appear here, for you
          to read in this tab.
        </p>
      ) : !unlocked || !opened ? (
        <p className={cards.lead} data-testid="received-locked">
          {count === 1 ? "1 payment is" : `${count} payments are`} sealed to your viewing key.
          Unlock your keys to read {count === 1 ? "it" : "them"} in this tab.
        </p>
      ) : (
        <>
          {unverified > 0 ? (
            <p className={cards.warning} role="alert">
              {unverified === 1
                ? `1 payment record did not verify against ${orgName}'s signature, so it was not opened.`
                : `${unverified} payment records did not verify against ${orgName}'s signature, so they were not opened.`}
            </p>
          ) : null}
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Memo</Th>
                <Th>Type</Th>
                <Th>Transaction</Th>
                <Th align="right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {newest.map((item) => {
                if (item.state !== "opened") {
                  return (
                    <tr key={item.id} data-testid="received-row" data-state={item.state}>
                      <Td>{formatDate(item.createdAt)}</Td>
                      <Td>
                        <span className={styles.muted}>
                          {item.state === "unverified"
                            ? "Not verified, not opened"
                            : "Not readable with your key"}
                        </span>
                      </Td>
                      <Td>{null}</Td>
                      <Td>{null}</Td>
                      <Td align="right">{null}</Td>
                    </tr>
                  );
                }
                const payload = item.payload;
                const signature = payload.signatures[0] ?? null;
                return (
                  <tr key={item.id} data-testid="received-row" data-state="opened">
                    <Td>{formatDate(payload.created_at)}</Td>
                    <Td>{payload.memo ?? <span className={styles.muted}>No memo</span>}</Td>
                    <Td>
                      <Chip>
                        {CATEGORY_LABEL[payload.category as PaymentCategory] ?? payload.category}
                      </Chip>
                    </Td>
                    <Td>
                      {signature ? (
                        network.cluster === "devnet" ? (
                          <a
                            className="mono"
                            href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {signature.slice(0, 12)}…
                          </a>
                        ) : (
                          <span className="mono">{signature.slice(0, 12)}…</span>
                        )
                      ) : null}
                    </Td>
                    <Td align="right">
                      <span className="num" data-testid="received-amount">
                        {formatTokenAmount(BigInt(payload.amount), DECIMALS)} USDC
                      </span>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </>
      )}
    </Card>
  );
}
