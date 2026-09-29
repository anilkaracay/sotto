"use client";

// The overview's recent activity (09 section 3; step 1.10). It lists the org's recent payments, since
// step 2.5 payroll lines with single payments (GET /orgs/:id/activity); each amount, memo and category
// opens in this tab from the owner's self disclosure of the payment (verified against the owner's
// manifest signature first, I-9), or, for a payment that has no disclosure yet (not settled), from its
// private blob. Both are sealed to the owner's viewing key, so nothing opens until the keys are
// unlocked in this tab. Since step 2.5 "Can read amount" names who else holds the payment's record:
// the recipient, and each holder of a readable grant (the design's avatars, as initials).
import { formatTokenAmount } from "@sotto/sdk/confidential/public";
import type { DisclosurePayloadV1 } from "@sotto/sdk/disclosure";
import { Button, Card, Chip, Table, Td, Th } from "@sotto/ui";
import Link from "next/link";
import { useEffect, useState } from "react";
import { callApi } from "../../../../lib/client/api.ts";
import { openDisclosures } from "../../../../lib/client/disclosures.ts";
import { formatDate, shortWallet } from "../../../../lib/format.ts";
import {
  CATEGORY_LABEL,
  parsePaymentPrivate,
  paymentStatusChip,
  type PaymentCategory,
} from "../../../../lib/payment.ts";
import { parseLinePrivate } from "../../../../lib/payroll.ts";
import type { ActivityPaymentView } from "../../../../lib/server/activity.ts";
import type { DisclosureItemView, ManifestView } from "../../../../lib/server/disclosures.ts";
import cards from "../../_components/confidential/cards.module.css";
import { useConfidential } from "../../_components/confidential/context.tsx";
import { useKeySession } from "../../_components/key-session.tsx";
import styles from "./overview.module.css";

/** The design's table shows the latest few; the payments page lists them all. */
const SHOWN = 8;
const DECIMALS = 6;
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

type Loaded = {
  payments: ActivityPaymentView[];
  items: DisclosureItemView[];
  manifests: ManifestView[];
};

export type Secret = { amount: string; memo: string | null; category: PaymentCategory | string };

function categoryLabel(category: string): string {
  return CATEGORY_LABEL[category as PaymentCategory] ?? category;
}

export function RecentActivity({ userId }: { userId: string }) {
  const { orgId, wallet } = useConfidential();
  const { session, viewing } = useKeySession();
  const unlocked = viewing?.wallet === wallet;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [opened, setOpened] = useState<{
    secrets: Record<string, Secret | "unreadable">;
    unverified: number;
  }>({ secrets: {}, unverified: 0 });

  // A new attempt (the Try again button) reads everything again.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void callApi<Loaded>(`/api/orgs/${orgId}/activity?limit=${SHOWN}`).then(
      (activity) => {
        if (!cancelled) setLoaded(activity);
      },
      () => {
        if (!cancelled) setProblem("Recent activity could not be loaded. Try again.");
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

  // While the tab holds the viewing key, the amounts open for this page only.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!loaded || !unlocked) {
        // Locked: nothing stays open.
        if (!cancelled) setOpened({ secrets: {}, unverified: 0 });
        return;
      }
      const open = (ciphertext: Uint8Array) => session.worker().openSealed(ciphertext);
      const disclosures = await openDisclosures({
        orgId,
        ownerWallet: wallet,
        viewerUserId: userId,
        items: loaded.items,
        manifests: loaded.manifests,
        open,
      });
      const bySubject = new Map<string, DisclosurePayloadV1>();
      for (const item of disclosures) {
        if (item.state === "opened") bySubject.set(item.payload.subject, item.payload);
      }
      const secrets: Record<string, Secret | "unreadable"> = {};
      for (const payment of loaded.payments) {
        const disclosed = bySubject.get(payment.id);
        if (disclosed) {
          secrets[payment.id] = {
            amount: disclosed.amount,
            memo: disclosed.memo,
            category: disclosed.category,
          };
          continue;
        }
        if (!payment.privateBlob) continue;
        try {
          const blob = await open(fromBase64(payment.privateBlob));
          if (payment.kind === "payroll_line") {
            const line = parseLinePrivate(blob);
            secrets[payment.id] = line
              ? { amount: line.amount, memo: line.memo, category: "payroll" }
              : "unreadable";
          } else {
            secrets[payment.id] = parsePaymentPrivate(blob) ?? "unreadable";
          }
        } catch {
          secrets[payment.id] = "unreadable";
        }
      }
      const unverified = disclosures.filter((item) => item.state === "unverified").length;
      if (!cancelled) setOpened({ secrets, unverified });
    })();
    return () => {
      cancelled = true;
    };
  }, [loaded, unlocked, session, orgId, wallet, userId]);

  return (
    <ActivityView
      orgId={orgId}
      state={
        problem
          ? { kind: "error", message: problem }
          : !loaded
            ? { kind: "loading" }
            : { kind: "loaded", payments: loaded.payments }
      }
      unlocked={unlocked}
      secrets={unlocked ? opened.secrets : {}}
      unverified={unlocked ? opened.unverified : 0}
      onRetry={retry}
    />
  );
}

export type ActivityState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "loaded"; payments: ActivityPaymentView[] };

/** "Can read amount": initials of who else holds the record, with their names for every reader. */
function Readers({ readers }: { readers: ActivityPaymentView["readers"] }) {
  if (readers.length === 0) return <span className={styles.muted}>Only you</span>;
  const names = readers.map((reader) => reader.name).join(", ");
  return (
    <span className={styles.readers} title={names} data-testid="activity-readers">
      {readers.map((reader, index) => (
        <span
          key={`${reader.via}:${reader.name}:${index}`}
          className={styles.reader}
          aria-hidden="true"
        >
          {reader.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
      <span className={styles.srOnly}>{names}</span>
    </span>
  );
}

/** The card itself, from what the container loaded and opened: the loading, error, empty, locked and filled states. */
export function ActivityView({
  orgId,
  state,
  unlocked,
  secrets,
  unverified,
  onRetry,
}: {
  orgId: string;
  state: ActivityState;
  unlocked: boolean;
  secrets: Record<string, Secret | "unreadable">;
  unverified: number;
  onRetry: () => void;
}) {
  const sealed = <span className={styles.muted}>Sealed</span>;

  return (
    <Card className={styles.wide} data-testid="recent-activity">
      <div className={styles.head}>
        <h2 className={cards.cardTitle}>Recent activity</h2>
        <Link className={styles.viewAll} href={`/app/${orgId}/payments/new`}>
          View all
        </Link>
      </div>
      {state.kind === "error" ? (
        <div className={cards.problem} role="alert" data-testid="activity-error">
          <p>{state.message}</p>
          <div className={cards.actions}>
            <Button variant="line" size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </div>
      ) : state.kind === "loading" ? (
        <p className={styles.empty} role="status" data-testid="activity-loading">
          Reading your recent payments…
        </p>
      ) : state.payments.length === 0 ? (
        <p className={styles.empty} data-testid="activity-empty">
          No payments yet. The payments you make appear here, with amounts only you can read.
        </p>
      ) : (
        <>
          {!unlocked ? (
            <p className={cards.lead} data-testid="activity-locked">
              Amounts, memos and types open in this tab once you unlock your keys.
            </p>
          ) : null}
          {unverified > 0 ? (
            <p className={cards.warning} role="alert">
              {unverified === 1
                ? "1 payment record did not verify against your wallet's signature, so it was not opened."
                : `${unverified} payment records did not verify against your wallet's signature, so they were not opened.`}
            </p>
          ) : null}
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Counterparty</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th>Can read amount</Th>
                <Th align="right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {state.payments.map((payment) => {
                const secret = unlocked ? secrets[payment.id] : undefined;
                const chip = paymentStatusChip(payment.status, payment.errorCode);
                const readable = secret !== undefined && secret !== "unreadable" ? secret : null;
                return (
                  <tr
                    key={payment.id}
                    data-testid="activity-row"
                    data-status={payment.status}
                    data-kind={payment.kind}
                  >
                    <Td>
                      <span className={`num ${styles.date}`}>{formatDate(payment.createdAt)}</span>
                    </Td>
                    <Td>
                      <span className={styles.person}>
                        <b>{payment.recipient.displayName}</b>
                        <small>
                          {readable?.memo ?? payment.run?.title ?? (
                            <span className="mono">{shortWallet(payment.recipient.wallet)}</span>
                          )}
                        </small>
                      </span>
                    </Td>
                    <Td>{readable ? <Chip>{categoryLabel(readable.category)}</Chip> : sealed}</Td>
                    <Td>
                      <Chip tone={chip.tone}>{chip.label}</Chip>
                    </Td>
                    <Td>
                      <Readers readers={payment.readers} />
                    </Td>
                    <Td align="right">
                      {readable ? (
                        <span className="num" data-testid="activity-amount">
                          {formatTokenAmount(BigInt(readable.amount), DECIMALS)} USDC
                        </span>
                      ) : secret === "unreadable" ? (
                        <span className={styles.muted}>Not readable with this key</span>
                      ) : (
                        sealed
                      )}
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
