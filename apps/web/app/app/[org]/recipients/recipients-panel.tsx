"use client";

// The recipients page's client part (F-07, AC-07.1 to AC-07.4; step 1.8): add recipients, see their
// readiness and why a recipient who is not ready cannot be paid confidentially, create invite links,
// check readiness again and remove recipients who have not joined. A default amount and notes are
// sealed in the tab's crypto worker to the owner's own viewing key, after its registration signature
// verifies (I-8, 07 section 5); the server stores only the sealed box. Since step 1.8.1 the page has
// the keys card: one Unlock click also unlocks the viewing key, and while the tab holds it the worker
// opens the default amounts for this page on its own.
import { parseTokenAmount } from "@sotto/sdk/confidential/public";
import { verifyViewKeyRegistration } from "@sotto/sdk/keys/public";
import {
  Button,
  Card,
  Field,
  FieldActions,
  FieldGrid,
  Input,
  Person,
  Select,
  Table,
  Td,
  Th,
} from "@sotto/ui";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { ApiCallError, callApi, invalidField } from "../../../../lib/client/api.ts";
import { COUNTRIES, countryName } from "../../../../lib/countries.ts";
import { formatDate, shortWallet } from "../../../../lib/format.ts";
import {
  notesProblem,
  parseRecipientPrivate,
  type RecipientPrivate,
} from "../../../../lib/recipient.ts";
import type { RecipientView } from "../../../../lib/server/recipients.ts";
import cards from "../../_components/confidential/cards.module.css";
import notices from "../../_components/confidential/confidential.module.css";
import {
  ConfidentialProvider,
  useConfidential,
  type AvailableNetwork,
} from "../../_components/confidential/context.tsx";
import { KeysCard, WalletCard } from "../../_components/confidential/keys.tsx";
import { useKeySession } from "../../_components/key-session.tsx";
import { ReadinessCell } from "./readiness-cell.tsx";
import styles from "./recipients.module.css";
import { Amount } from "../../_components/privacy.tsx";
import { formatAmount } from "../../../../lib/asset-words.ts";
import { AssetBadge, useAssetWords } from "../../_components/asset.tsx";

export type OwnerViewerKey = { publicKey: string; signature: string };

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const DECIMALS = 6;

export function RecipientsPanel(props: {
  wallet: string;
  orgId: string;
  network: AvailableNetwork;
  recipients: RecipientView[];
  viewerKey: OwnerViewerKey | null;
}) {
  return (
    <ConfidentialProvider
      wallet={props.wallet}
      orgId={props.orgId}
      network={props.network}
      readAccount={false}
    >
      <div className={cards.grid}>
        <AddRecipientCard viewerKey={props.viewerKey} />
        <div className={styles.side}>
          <WalletCard />
          <KeysCard />
        </div>
        <RecipientsTable recipients={props.recipients} />
      </div>
    </ConfidentialProvider>
  );
}

type Fields = {
  displayName: string;
  roleTitle: string;
  team: string;
  country: string;
  wallet: string;
  amount: string;
  notes: string;
};

const EMPTY: Fields = {
  displayName: "",
  roleTitle: "",
  team: "",
  country: "",
  wallet: "",
  amount: "",
  notes: "",
};

function AddRecipientCard({ viewerKey }: { viewerKey: OwnerViewerKey | null }) {
  const asset = useAssetWords();
  const { wallet, orgId } = useConfidential();
  const { session } = useKeySession();
  const router = useRouter();
  const id = useId();
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (name: keyof Fields) => (value: string) =>
    setFields((current) => ({ ...current, [name]: value }));

  /** The default amount and notes, sealed to the owner's verified viewing key, or null. */
  async function privateBlob(): Promise<string | null> {
    if (!fields.amount.trim() && !fields.notes.trim()) return null;
    if (!viewerKey) {
      throw new Error("Register your public viewing key on the Account setup page first.");
    }
    const amount = fields.amount.trim() ? parseTokenAmount(fields.amount, DECIMALS) : null;
    if (fields.amount.trim() && amount === null) {
      setErrors((current) => ({
        ...current,
        amount: `Enter an amount above zero with at most ${DECIMALS} decimals`,
      }));
      throw new Error("");
    }
    const notes = notesProblem(fields.notes.trim());
    if (notes) {
      setErrors((current) => ({ ...current, notes }));
      throw new Error("");
    }
    const publicKey = fromBase64(viewerKey.publicKey);
    const verified = await verifyViewKeyRegistration({
      wallet,
      publicKey,
      signature: fromBase64(viewerKey.signature),
    });
    if (!verified) {
      throw new Error(
        "Your viewing key's registration does not verify for your wallet, so Sotto does not encrypt to it.",
      );
    }
    const value: RecipientPrivate = {
      v: 1,
      default_amount: amount === null ? null : amount.toString(),
      notes: fields.notes.trim() || null,
    };
    return toBase64(await session.worker().seal(publicKey, value));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setProblem(null);
    try {
      const blob = await privateBlob();
      await callApi(`/api/orgs/${orgId}/recipients`, {
        method: "POST",
        body: {
          displayName: fields.displayName,
          roleTitle: fields.roleTitle,
          team: fields.team,
          country: fields.country || null,
          wallet: fields.wallet,
          ...(blob ? { privateBlob: blob } : {}),
        },
      });
      setFields(EMPTY);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiCallError) {
        const field = invalidField(error);
        if (field && field.field in EMPTY) {
          setErrors({ [field.field]: field.message });
        } else {
          setProblem(error.message);
        }
      } else if (error instanceof Error && error.message) {
        setProblem(error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  const input = (
    name: keyof Fields,
    label: string,
    options: { wide?: boolean; hint?: string; mono?: boolean } = {},
  ) => (
    <Field
      label={label}
      htmlFor={`${id}-${name}`}
      hint={options.hint}
      error={errors[name]}
      wide={options.wide ?? false}
    >
      <Input
        id={`${id}-${name}`}
        className={options.mono ? styles.mono : undefined}
        value={fields[name]}
        onChange={(event) => set(name)(event.target.value)}
        aria-invalid={errors[name] ? true : undefined}
        disabled={(name === "amount" || name === "notes") && !viewerKey}
        data-amount={name === "amount" ? "" : undefined}
      />
    </Field>
  );

  return (
    <Card data-testid="add-recipient-card">
      <h2 className={cards.cardTitle}>Add a recipient</h2>
      <p className={cards.lead}>
        A person or company you pay in {asset.wrappedSymbol}. The default amount and notes are
        encrypted in this tab to your viewing key, so only you can read them; Sotto stores them
        sealed. <AssetBadge />
      </p>
      <form onSubmit={submit} noValidate>
        <FieldGrid>
          {input("displayName", "Name", { wide: true })}
          {input("roleTitle", "Role")}
          {input("team", "Team")}
          <Field label="Country" htmlFor={`${id}-country`} error={errors.country}>
            <Select
              id={`${id}-country`}
              value={fields.country}
              onChange={(event) => set("country")(event.target.value)}
            >
              <option value="">Not set</option>
              {COUNTRIES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          {input("amount", `Default amount (${asset.symbol})`, {
            hint: viewerKey ? "Optional, encrypted to you" : "Needs your public viewing key",
          })}
          {input("wallet", "Solana wallet address", { wide: true, mono: true })}
          {input("notes", "Notes", {
            wide: true,
            hint: viewerKey
              ? "Optional, encrypted to you"
              : "Register your public viewing key on the Account setup page to keep a default amount and notes, encrypted to you.",
          })}
          {problem ? (
            <p className={`${cards.problem} ${styles.wide}`} role="alert">
              {problem}
            </p>
          ) : null}
          <FieldActions>
            <Button type="submit" variant="blue" disabled={busy}>
              {busy ? "Adding…" : "Add recipient"}
            </Button>
          </FieldActions>
        </FieldGrid>
      </form>
    </Card>
  );
}

function RecipientsTable({ recipients }: { recipients: RecipientView[] }) {
  const asset = useAssetWords();
  const { wallet, orgId } = useConfidential();
  const { session, viewing } = useKeySession();
  const router = useRouter();
  const [opened, setOpened] = useState<Record<string, RecipientPrivate | "unreadable">>({});
  const [links, setLinks] = useState<Record<string, { url: string; expiresAt: string }>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const unlocked = viewing?.wallet === wallet;
  const sealed = recipients.filter((row) => row.privateBlob !== null);

  // While the tab holds the viewing key (one Unlock click), the worker opens the default amounts for
  // this page; after a lock nothing stays opened.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, RecipientPrivate | "unreadable"> = {};
      if (unlocked) {
        for (const row of recipients) {
          if (row.privateBlob === null) continue;
          try {
            const value = await session.openWorker().openSealed(fromBase64(row.privateBlob));
            next[row.id] = parseRecipientPrivate(value) ?? "unreadable";
          } catch {
            next[row.id] = "unreadable";
          }
        }
      }
      if (!cancelled) setOpened(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [unlocked, recipients, session]);

  async function act(key: string, run: () => Promise<void>) {
    setBusy(key);
    setProblem(null);
    try {
      await run();
    } catch (error) {
      setProblem(error instanceof ApiCallError ? error.message : "That did not work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  const invite = (row: RecipientView) =>
    act(`invite:${row.id}`, async () => {
      const { invite: created } = await callApi<{ invite: { url: string; expiresAt: string } }>(
        `/api/orgs/${orgId}/invites`,
        { method: "POST", body: { role: "recipient", recipientId: row.id } },
      );
      setLinks((current) => ({ ...current, [row.id]: created }));
      router.refresh();
    });
  const check = (row: RecipientView) =>
    act(`check:${row.id}`, async () => {
      await callApi(`/api/orgs/${orgId}/recipients/${row.id}/readiness`, { method: "POST" });
      router.refresh();
    });
  const remove = (row: RecipientView) =>
    act(`remove:${row.id}`, async () => {
      const response = await fetch(`/api/orgs/${orgId}/recipients/${row.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: { code?: string; message?: string };
        };
        throw new ApiCallError(
          response.status,
          body.error?.code ?? "request_failed",
          body.error?.message ?? "Request failed",
        );
      }
      setConfirming(null);
      router.refresh();
    });

  const amountCell = (row: RecipientView) => {
    if (row.privateBlob === null) return <span className={styles.muted}>None</span>;
    const value = opened[row.id];
    if (!unlocked || value === undefined) return <span className={styles.muted}>Sealed</span>;
    if (value === "unreadable")
      return <span className={styles.muted}>Not readable with this key</span>;
    return (
      <span>
        {value.default_amount === null ? (
          <span className={styles.muted}>No amount</span>
        ) : (
          <span className="num" data-testid="default-amount">
            <Amount>{formatAmount(BigInt(value.default_amount), asset)}</Amount>
          </span>
        )}
        {value.notes ? <small className={styles.muted}> · {value.notes}</small> : null}
      </span>
    );
  };

  return (
    <Card className={styles.tableCard} data-testid="recipients-card">
      <div className={styles.head}>
        <h2 className={cards.cardTitle}>Recipients</h2>
        <small className={styles.count}>
          {recipients.length === 1 ? "1 recipient" : `${recipients.length} recipients`}
        </small>
      </div>
      {sealed.length > 0 && !unlocked ? (
        <p className={styles.sealedNote} data-testid="amounts-sealed-note">
          Default amounts open in this tab once you unlock your keys.
        </p>
      ) : null}
      {problem ? (
        <p className={cards.problem} role="alert">
          {problem}
        </p>
      ) : null}
      {recipients.length === 0 ? (
        <p className={styles.empty} data-testid="recipients-empty">
          No recipients yet. Add the people and companies you pay.
        </p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Recipient</Th>
              <Th>Team</Th>
              <Th>Country</Th>
              <Th>Wallet</Th>
              <Th>Default amount</Th>
              <Th>Status</Th>
              <Th align="right">Actions</Th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((row) => (
              <RecipientRows
                key={row.id}
                row={row}
                amount={amountCell(row)}
                link={links[row.id] ?? null}
                busy={busy}
                confirming={confirming === row.id}
                onInvite={() => void invite(row)}
                onCheck={() => void check(row)}
                onRemove={() => (confirming === row.id ? void remove(row) : setConfirming(row.id))}
              />
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function RecipientRows(props: {
  row: RecipientView;
  amount: ReactNode;
  link: { url: string; expiresAt: string } | null;
  busy: string | null;
  confirming: boolean;
  onInvite: () => void;
  onCheck: () => void;
  onRemove: () => void;
}) {
  const { row } = props;
  const [copied, setCopied] = useState(false);
  return (
    <>
      <tr data-testid="recipient-row" data-wallet={row.wallet}>
        <Td>
          <Person name={row.displayName} detail={row.roleTitle} size={36} />
        </Td>
        <Td>{row.team ?? <span className={styles.muted}>None</span>}</Td>
        <Td>
          {row.country ? countryName(row.country) : <span className={styles.muted}>None</span>}
        </Td>
        <Td>
          <span className="mono" title={row.wallet}>
            {shortWallet(row.wallet)}
          </span>
        </Td>
        <Td>{props.amount}</Td>
        <Td>
          <ReadinessCell readiness={row.readiness}>
            {row.joined ? (
              <small className={styles.joined}>Joined</small>
            ) : row.invite.status === "pending" && row.invite.expiresAt && !props.link ? (
              // Sotto cannot know whether the owner sent the link, only until when it works.
              <small className={styles.invited}>
                Invite open until {formatDate(row.invite.expiresAt)}
              </small>
            ) : null}
          </ReadinessCell>
        </Td>
        <Td align="right">
          <div className={styles.rowActions}>
            {!row.joined ? (
              <Button
                variant="line"
                size="sm"
                disabled={props.busy !== null}
                onClick={props.onInvite}
              >
                {row.invite.status === "pending" ? "New invite link" : "Invite link"}
              </Button>
            ) : null}
            {row.readiness !== "ready" ? (
              <Button
                variant="line"
                size="sm"
                disabled={props.busy !== null}
                onClick={props.onCheck}
              >
                {props.busy === `check:${row.id}` ? "Checking…" : "Check again"}
              </Button>
            ) : null}
            {!row.joined ? (
              <Button
                variant="line"
                size="sm"
                disabled={props.busy !== null}
                onClick={props.onRemove}
              >
                {props.confirming ? "Confirm remove" : "Remove"}
              </Button>
            ) : null}
          </div>
        </Td>
      </tr>
      {props.link ? (
        <tr className={styles.linkRow}>
          <Td colSpan={7}>
            <div className={`${notices.info} ${styles.link}`}>
              <b>Send this link to {row.displayName}</b>
              <div className={styles.linkField}>
                <Input
                  className={styles.mono}
                  readOnly
                  value={props.link.url}
                  aria-label={`Invite link for ${row.displayName}`}
                  data-testid="invite-link"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button
                  variant="line"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(props.link?.url ?? "")
                      .then(() => setCopied(true));
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <small>
                It works once, only with {shortWallet(row.wallet)}, until{" "}
                {formatDate(props.link.expiresAt)}. Sotto shows it only now.
              </small>
            </div>
          </Td>
        </tr>
      ) : null}
    </>
  );
}
