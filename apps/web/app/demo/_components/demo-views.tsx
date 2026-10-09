"use client";

// The demo company's screens (step 4.6, D-32): what each role reads, from the real records. Each
// screen asks the demo's read only routes for that role's view and, where the role has a viewing key,
// for the published demo keys; the records are checked against the owner's signed manifests and
// opened in the demo's own worker (lib/client/demo.ts). Nothing here writes, signs or knows a wallet:
// no button changes anything, and "Verify on Solana" leaves for the explorer.
import type { DisclosurePayloadV1 } from "@sotto/sdk/disclosure";
import { Card, Chip } from "@sotto/ui";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { assetWords, formatAmount, type AssetWords } from "../../../lib/asset-words.ts";
import { ledgerRows, sum } from "../../../lib/books.ts";
import { chainAmountWords, chainTypeWords } from "../../../lib/chain-activity.ts";
import { demoGet, openDemoRecords } from "../../../lib/client/demo.ts";
import type { OpenedDisclosure } from "../../../lib/client/disclosures.ts";
import { demoRoleTitle, type DemoKeyRole } from "../../../lib/demo.ts";
import { explorerUrl } from "../../../lib/explorer.ts";
import { formatDate, shortWallet } from "../../../lib/format.ts";
import { expiryWords, scopeWords } from "../../../lib/grant.ts";
import { payslipsOf } from "../../../lib/pay.ts";
import { statementWords, verifyPath } from "../../../lib/proofs.ts";
import type { ChainActivityView } from "../../../lib/server/chain-activity.ts";
import type {
  DemoAccountantView,
  DemoCompareView,
  DemoEmployeeView,
  DemoKeysView,
  DemoOutsiderView,
  DemoOwnerView,
  DemoProofView,
} from "../../../lib/server/demo.ts";
import styles from "./demo.module.css";

/** The demo runs on devnet only, so every link names devnet. */
function VerifyOnSolana({
  target,
  value,
  what,
}: {
  target: "tx" | "address";
  value: string | null | undefined;
  /** What the link shows, for a screen reader: "the transfer", "the account". */
  what: string;
}) {
  const href = value ? explorerUrl(target, value, "devnet") : null;
  if (!href) return null;
  return (
    <a
      className={styles.verify}
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={`Verify on Solana: ${what}`}
      data-testid="verify-on-solana"
    >
      Verify on Solana
    </a>
  );
}

type Loaded<V> =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; view: V; records: OpenedDisclosure[] };

/** A role's view and, for a role with a key, its records opened with the published key. */
function useDemoView<V>(
  name: string,
  open?: (view: V, keys: DemoKeysView) => Promise<OpenedDisclosure[]>,
): Loaded<V> {
  const [loaded, setLoaded] = useState<Loaded<V>>({ state: "loading" });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { view } = await demoGet<{ view: V }>(`/api/demo/views/${name}`);
        const records = open ? await open(view, await demoGet<DemoKeysView>("/api/demo/keys")) : [];
        if (!cancelled) setLoaded({ state: "ready", view, records });
      } catch (error) {
        if (!cancelled) {
          setLoaded({
            state: "error",
            message: error instanceof Error ? error.message : "The demo company could not be read.",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // The opener is fixed per screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  return loaded;
}

const openAs =
  <V extends { ownerWallet: string; viewerUserId: string; sealed: DemoOwnerView["sealed"] }>(
    role: DemoKeyRole,
  ) =>
  (view: V, keys: DemoKeysView) =>
    openDemoRecords({
      role,
      keys,
      ownerWallet: view.ownerWallet,
      viewerUserId: view.viewerUserId,
      sealed: view.sealed,
    });

const payloadsOf = (records: readonly OpenedDisclosure[]): DisclosurePayloadV1[] =>
  records.flatMap((record) => (record.state === "opened" ? [record.payload] : []));

function Waiting({
  loaded,
}: {
  loaded: { state: "loading" } | { state: "error"; message: string };
}) {
  return loaded.state === "loading" ? (
    <p className={styles.status} role="status" data-testid="demo-loading">
      Reading the records and opening them in this browser…
    </p>
  ) : (
    <p className={styles.problem} role="alert" data-testid="demo-problem">
      {loaded.message}
    </p>
  );
}

/** Records that did not pass the owner's manifest or did not open are counted, never shown. */
function Unverified({ records }: { records: readonly OpenedDisclosure[] }) {
  const hidden = records.filter((record) => record.state !== "opened").length;
  return hidden ? (
    <p className={styles.problem} role="alert">
      {hidden} {hidden === 1 ? "record is" : "records are"} hidden: not signed by the owner, or not
      for this key.
    </p>
  ) : null;
}

function Heading({ role, children }: { role: string; children: ReactNode }) {
  return (
    <header>
      <small className={styles.overline}>{role}</small>
      <h1 className={styles.title}>{children}</h1>
    </header>
  );
}

function Proofs({ proofs, asset }: { proofs: DemoProofView[]; asset: AssetWords }) {
  return (
    <Card data-testid="demo-proofs">
      <h2 className={styles.sectionTitle}>Proofs of funds</h2>
      <p className={styles.note}>
        A proof says the sealed balance is at least a threshold. It reveals no balance.
      </p>
      {proofs.length === 0 ? (
        <p className={styles.status}>No proof record yet.</p>
      ) : (
        <ul className={styles.rows}>
          {proofs.map((proof) => (
            <li key={proof.recordAddress} className={styles.row}>
              <span className={styles.rowName}>
                {statementWords(BigInt(proof.threshold), asset)}
              </span>
              <span className={styles.rowAmount}>
                <Chip tone="green">Onchain record</Chip>
              </span>
              <span className={styles.rowMeta}>
                {proof.counterpartyLabel ? <span>For {proof.counterpartyLabel}</span> : null}
                <span>Valid until {formatDate(proof.expiry)}</span>
                <Link
                  className={styles.verify}
                  href={verifyPath(proof.recordAddress)}
                  prefetch={false}
                >
                  Open the public proof
                </Link>
                <VerifyOnSolana
                  target="address"
                  value={proof.recordAddress}
                  what="the proof record"
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ChainRows({ chain, asset }: { chain: ChainActivityView[]; asset: AssetWords }) {
  return (
    <ul className={styles.rows} data-testid="demo-chain">
      {chain.map((row) => {
        const amount = chainAmountWords(row, asset);
        return (
          <li key={row.id} className={styles.row}>
            <span className={styles.rowName}>{chainTypeWords(row.type, asset)}</span>
            <span
              className={`${styles.rowAmount} ${amount.kind === "public" ? "" : styles.sealed}`}
            >
              {amount.text}
            </span>
            <span className={styles.rowMeta}>
              {row.blockTime ? <span>{formatDate(row.blockTime)}</span> : null}
              <span className="mono">
                {shortWallet(row.tokenAccount)}
                {row.counterparty ? ` to ${shortWallet(row.counterparty)}` : ""}
              </span>
              <VerifyOnSolana target="tx" value={row.signature} what="the transaction" />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function OwnerScreen() {
  const loaded = useDemoView<DemoOwnerView>("owner", openAs("owner"));
  if (loaded.state !== "ready") return <Waiting loaded={loaded} />;
  const { view, records } = loaded;
  const asset = assetWords(view.org.asset);
  const payloads = payloadsOf(records);
  const snapshot = payloads
    .filter((payload) => payload.kind === "balance_snapshot")
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
  const account = view.chain[0]?.tokenAccount ?? null;
  const paid = view.payments.flatMap((payment) => {
    const payload = payloads.find((entry) => entry.subject === payment.id);
    return payload ? [{ payment, payload }] : [];
  });
  return (
    <>
      <Heading role={demoRoleTitle("owner")}>{view.org.displayName}</Heading>
      <Unverified records={records} />
      <div className={styles.grid}>
        <div className={styles.column}>
          <Card data-testid="demo-balance">
            <h2 className={styles.sectionTitle}>Confidential balance</h2>
            {snapshot ? (
              <>
                <b className={styles.figure} data-testid="demo-balance-amount">
                  {formatAmount(BigInt(snapshot.amount), asset)}
                </b>
                <p className={styles.note} data-testid="demo-balance-date">
                  As recorded on {formatDate(snapshot.created_at)}, from Elif&apos;s latest signed
                  balance snapshot. Pending: {formatAmount(BigInt(snapshot.pending ?? "0"), asset)}.
                  Onchain the balance is sealed; the live number needs Elif&apos;s wallet, which is
                  not here.
                </p>
              </>
            ) : (
              <p className={styles.note}>No balance snapshot has been recorded yet.</p>
            )}
            <VerifyOnSolana
              target="address"
              value={account}
              what="the account, its balance sealed"
            />
          </Card>
          <Card data-testid="demo-payments">
            <h2 className={styles.sectionTitle}>Payments and payroll</h2>
            <p className={styles.note}>
              Every amount here is sealed onchain. Elif reads them from her own records.
            </p>
            <ul className={styles.rows}>
              {paid.map(({ payment, payload }) => (
                <li key={payment.id} className={styles.row} data-testid="demo-payment">
                  <span className={styles.rowName}>{payment.recipient.displayName}</span>
                  <span className={styles.rowAmount}>
                    {formatAmount(BigInt(payload.amount), asset)}
                  </span>
                  <span className={styles.rowMeta}>
                    <span>{formatDate(payment.settledAt ?? payload.created_at)}</span>
                    <span>{payment.run ? payment.run.title : (payload.memo ?? "Payment")}</span>
                    {payment.readers.length ? (
                      <span>
                        Also readable by {payment.readers.map((reader) => reader.name).join(", ")}
                      </span>
                    ) : null}
                    <VerifyOnSolana target="tx" value={payload.signatures[0]} what="the transfer" />
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className={styles.column}>
          <Card data-testid="demo-grants">
            <h2 className={styles.sectionTitle}>Who holds a viewing key</h2>
            <p className={styles.note}>
              Elif decides who reads which numbers, and can revoke a key with her wallet.
            </p>
            <ul className={styles.rows}>
              {view.grants.map((grant) => (
                <li key={grant.id} className={styles.row}>
                  <span className={styles.rowName}>{grant.holder.name}</span>
                  <span className={styles.rowAmount}>
                    <Chip tone={grant.status === "active" ? "green" : "neutral"}>
                      {grant.status === "active" ? "Active" : "Not active"}
                    </Chip>
                  </span>
                  <span className={styles.rowMeta}>
                    {grant.holder.title ? <span>{grant.holder.title}</span> : null}
                    <span>{scopeWords(grant.scope, grant.periodFrom, grant.periodTo)}</span>
                    <span>{expiryWords(grant.expiresAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
          <Proofs proofs={view.proofs} asset={asset} />
        </div>
      </div>
    </>
  );
}

export function AccountantScreen() {
  const loaded = useDemoView<DemoAccountantView>("accountant", openAs("accountant"));
  const [search, setSearch] = useState("");
  if (loaded.state !== "ready") return <Waiting loaded={loaded} />;
  const { view, records } = loaded;
  const asset = assetWords(view.org.asset);
  const ledger = ledgerRows(payloadsOf(records), view.books.payments);
  const needle = search.trim().toLowerCase();
  const rows = needle
    ? ledger.filter((row) => `${row.counterparty} ${row.memo ?? ""}`.toLowerCase().includes(needle))
    : ledger;
  const grant = view.books.grants[0];
  return (
    <>
      <Heading role={demoRoleTitle("accountant")}>Books of {view.org.displayName}</Heading>
      {grant ? (
        <p className={styles.lead} data-testid="demo-scope">
          Shared by {view.org.displayName}:{" "}
          {scopeWords(grant.scope, grant.periodFrom, grant.periodTo)}.{" "}
          {expiryWords(grant.expiresAt)}. Daniel reads these records with his viewing key and can
          change nothing.
        </p>
      ) : null}
      <Unverified records={records} />
      <Card data-testid="demo-ledger">
        <h2 className={styles.sectionTitle}>Ledger</h2>
        <p className={styles.note} data-testid="demo-ledger-total">
          {rows.length} {rows.length === 1 ? "payment" : "payments"},{" "}
          {formatAmount(sum(rows), asset)} in total. The search runs in this browser only.
        </p>
        <label className={styles.note}>
          Search by name or memo{" "}
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            data-testid="demo-search"
          />
        </label>
        <ul className={styles.rows}>
          {rows.map((row) => (
            <li key={row.id} className={styles.row} data-testid="demo-ledger-row">
              <span className={styles.rowName}>{row.counterparty}</span>
              <span className={styles.rowAmount}>{formatAmount(row.amount, asset)}</span>
              <span className={styles.rowMeta}>
                <span>{formatDate(row.date)}</span>
                <span>{row.memo ?? (row.kind === "payroll_line" ? "Payroll" : "Payment")}</span>
                <VerifyOnSolana
                  target="tx"
                  value={row.payment.chain?.signature}
                  what="the transfer"
                />
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

export function EmployeeScreen() {
  const loaded = useDemoView<DemoEmployeeView>("employee", openAs("employee"));
  if (loaded.state !== "ready") return <Waiting loaded={loaded} />;
  const { view, records } = loaded;
  const asset = assetWords(view.org.asset);
  const slips = payslipsOf(payloadsOf(records), view.pay);
  return (
    <>
      <Heading role={demoRoleTitle("employee")}>
        {view.pay.recipient.displayName}&apos;s pay from {view.org.displayName}
      </Heading>
      <p className={styles.lead}>
        {view.pay.recipient.roleTitle ? `${view.pay.recipient.roleTitle}. ` : ""}Maya sees her own
        payslips and nothing of anyone else&apos;s pay.
      </p>
      <Unverified records={records} />
      <Card data-testid="demo-payslips">
        <h2 className={styles.sectionTitle}>Payslips</h2>
        <ul className={styles.rows}>
          {slips.map((slip) => (
            <li key={slip.id} className={styles.row} data-testid="demo-payslip">
              <span className={styles.rowName}>Net pay, {formatDate(slip.date)}</span>
              <span className={styles.rowAmount}>{formatAmount(slip.net, asset)}</span>
              <span className={styles.rowMeta}>
                {slip.gross !== null ? <span>Gross {formatAmount(slip.gross, asset)}</span> : null}
                {slip.tax !== null ? <span>Tax {formatAmount(slip.tax, asset)}</span> : null}
                {slip.memo ? <span>{slip.memo}</span> : null}
                {slip.readers.length ? (
                  <span>Also readable by {slip.readers.join(", ")}</span>
                ) : null}
                <VerifyOnSolana target="tx" value={slip.signature} what="the transfer" />
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className={styles.sectionTitle}>Her account</h2>
        <p className={styles.note}>
          The payments arrive in Maya&apos;s confidential account. Its balance is sealed onchain;
          reading it needs her wallet, which is not here.
        </p>
        <VerifyOnSolana
          target="address"
          value={view.pay.tokenAccount}
          what="Maya's account, its balance sealed"
        />
      </Card>
    </>
  );
}

export function OutsiderScreen() {
  const loaded = useDemoView<DemoOutsiderView>("outsider");
  if (loaded.state !== "ready") return <Waiting loaded={loaded} />;
  const { view } = loaded;
  const asset = assetWords(view.org.asset);
  return (
    <>
      <Heading role={demoRoleTitle("outsider")}>
        What anyone can see of {view.org.displayName}
      </Heading>
      <p className={styles.lead}>
        No key, no sign in. The chain shows who paid whom and when. A confidential transfer&apos;s
        amount is sealed; a deposit&apos;s amount is public.
      </p>
      <div className={styles.grid}>
        <Card>
          <h2 className={styles.sectionTitle}>What the chain shows</h2>
          <ChainRows chain={view.chain} asset={asset} />
        </Card>
        <Proofs proofs={view.proofs} asset={asset} />
      </div>
    </>
  );
}

type Side = {
  item: DemoCompareView["owner"]["item"];
  manifests: DemoCompareView["owner"]["manifests"];
  viewerUserId: string;
};

export function CompareScreen() {
  const loaded = useDemoView<DemoCompareView>("compare");
  const [opened, setOpened] = useState<{
    owner: DisclosurePayloadV1 | null;
    accountant: DisclosurePayloadV1 | null;
    employee: DisclosurePayloadV1 | null;
  } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const view = loaded.state === "ready" ? loaded.view : null;
  useEffect(() => {
    if (!view) return;
    let cancelled = false;
    void (async () => {
      try {
        const keys = await demoGet<DemoKeysView>("/api/demo/keys");
        // Each column opens its own role's record with its own role's key.
        const one = async (role: DemoKeyRole, side: Side) =>
          payloadsOf(
            await openDemoRecords({
              role,
              keys,
              ownerWallet: view.ownerWallet,
              viewerUserId: side.viewerUserId,
              sealed: { items: side.item ? [side.item] : [], manifests: side.manifests },
            }),
          )[0] ?? null;
        const next = {
          owner: await one("owner", view.owner),
          accountant: await one("accountant", view.accountant),
          employee: await one("employee", view.employee),
        };
        if (!cancelled) setOpened(next);
      } catch (error) {
        if (!cancelled) {
          setProblem(error instanceof Error ? error.message : "The records could not be opened.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view]);
  if (loaded.state !== "ready") return <Waiting loaded={loaded} />;
  if (problem) return <Waiting loaded={{ state: "error", message: problem }} />;
  if (!view || !opened) return <Waiting loaded={{ state: "loading" }} />;
  const asset = assetWords(view.org.asset);
  const grant = view.accountant.grant;
  return (
    <>
      <Heading role="Compare views">One payment, four readers</Heading>
      <p className={styles.lead} data-testid="demo-compare-lead">
        {view.org.displayName} paid {view.recipient ?? "a supplier"}. Each column is what that
        role&apos;s own view holds for this one payment.
      </p>
      <div className={styles.compare}>
        <Card className={styles.side} data-testid="compare-owner">
          <small>{demoRoleTitle("owner")}</small>
          <h2>Her own record</h2>
          {opened.owner ? (
            <>
              <b className={styles.sideAmount}>
                {formatAmount(BigInt(opened.owner.amount), asset)}
              </b>
              <dl className={styles.details}>
                <dt>To</dt>
                <dd>{opened.owner.counterparty}</dd>
                <dt>Memo</dt>
                <dd>{opened.owner.memo ?? "None"}</dd>
                <dt>Settled</dt>
                <dd>{formatDate(opened.owner.created_at)}</dd>
              </dl>
              <VerifyOnSolana
                target="tx"
                value={opened.owner.signatures[0]}
                what="the transfer of Elif's record"
              />
            </>
          ) : (
            <p className={styles.note}>Her view holds no record of this payment.</p>
          )}
        </Card>
        <Card className={styles.side} data-testid="compare-accountant">
          <small>{demoRoleTitle("accountant")}</small>
          <h2>The copy Elif shared</h2>
          {opened.accountant ? (
            <>
              <b className={styles.sideAmount}>
                {formatAmount(BigInt(opened.accountant.amount), asset)}
              </b>
              <dl className={styles.details}>
                <dt>To</dt>
                <dd>{opened.accountant.counterparty}</dd>
                <dt>Memo</dt>
                <dd>{opened.accountant.memo ?? "None"}</dd>
                <dt>Under</dt>
                <dd>
                  {grant
                    ? scopeWords(grant.scope, grant.periodFrom, grant.periodTo)
                    : "His viewing key"}
                </dd>
              </dl>
              <VerifyOnSolana
                target="tx"
                value={opened.accountant.signatures[0]}
                what="the transfer of Daniel's copy"
              />
            </>
          ) : (
            <p className={styles.note}>His viewing key does not cover this payment.</p>
          )}
        </Card>
        <Card className={styles.side} data-testid="compare-employee">
          <small>{demoRoleTitle("employee")}</small>
          <h2>Not hers to see</h2>
          {opened.employee ? (
            <b className={styles.sideAmount}>
              {formatAmount(BigInt(opened.employee.amount), asset)}
            </b>
          ) : (
            <>
              <b className={`${styles.sideAmount} ${styles.sealed}`}>No record</b>
              <p className={styles.note}>
                Maya&apos;s view holds {view.employee.records}{" "}
                {view.employee.records === 1 ? "record" : "records"}, her own pay. This payment is
                not among them: of it she sees what an outsider sees.
              </p>
            </>
          )}
        </Card>
        <Card className={styles.side} data-testid="compare-outsider">
          <small>{demoRoleTitle("outsider")}</small>
          <h2>The chain</h2>
          <b className={`${styles.sideAmount} ${styles.sealed}`}>
            {view.outsider.chain ? chainAmountWords(view.outsider.chain, asset).text : "Sealed"}
          </b>
          <dl className={styles.details}>
            <dt>From</dt>
            <dd className="mono">
              {view.outsider.from ? shortWallet(view.outsider.from) : "Unknown"}
            </dd>
            <dt>To</dt>
            <dd className="mono">{view.outsider.to ? shortWallet(view.outsider.to) : "Unknown"}</dd>
            <dt>When</dt>
            <dd>{view.outsider.blockTime ? formatDate(view.outsider.blockTime) : "Unknown"}</dd>
          </dl>
          <p className={styles.note}>
            The explorer shows the transfer and its accounts, and no amount.
          </p>
          <VerifyOnSolana
            target="tx"
            value={view.outsider.signature}
            what="the transfer, which shows no amount"
          />
        </Card>
      </div>
    </>
  );
}
