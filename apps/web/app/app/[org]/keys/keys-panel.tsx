"use client";

// The viewing keys page's client part (F-10, F-14; step 2.4), on the design's Access screen where data
// exists (13 A5, A19 to A23, A27, A28):
// - Who can read <org>: a bar per active key, its records out of the owner's own records of the last
//   12 months, computed here from counts (09 section 3); none of the holders are at Sotto (A5);
// - Keys stay yours: the latest active key, its holder, what it reads, its public key and its end;
// - Share past records: a key that became active gets the owner's records in its scope (AC-10.3): the
//   owner's own records are verified against the owner's manifests (I-9), opened with the viewing key
//   in this tab, sealed to the holder's key whose registration verifies (I-8), and stored under a
//   manifest the owner signs, at most 500 per manifest;
// - Keys: every grant with its holder, scope, expiry, last use and status, a new invite link while
//   its holder has not accepted, and Revoke with the copy of AC-10.4;
// - Access log: the last 7 days, metadata only (AC-14.1);
// - Grant a key: the drawer with the holder, what they can read, the expiry (No expiry included, X-52)
//   and a preview; granting shows the invite link once.
import { buildManifest, manifestMessage } from "@sotto/sdk/disclosure";
import { verifyViewKeyRegistration } from "@sotto/sdk/keys/public";
import {
  Button,
  Card,
  Chip,
  Drawer,
  Field,
  initials,
  Input,
  PageHeader,
  Person,
  Table,
  Td,
  Th,
} from "@sotto/ui";
import { useId, useState } from "react";
import { eventWords, whenWords } from "../../../../lib/access-log.ts";
import { ApiCallError, callApi } from "../../../../lib/client/api.ts";
import { openDisclosures } from "../../../../lib/client/disclosures.ts";
import { withWalletWords } from "../../../../lib/client/wallet-words.ts";
import { formatDate } from "../../../../lib/format.ts";
import {
  currentQuarter,
  expiryWords,
  GRANT_EXPIRY_CHOICES,
  GRANT_SCOPE_CHOICES,
  grantStatusChip,
  lastUsedWords,
  previewExpiry,
  REVOKE_COPY,
  scopeWords,
  type GrantExpiryChoiceName,
} from "../../../../lib/grant.ts";
import type { AccessEventView } from "../../../../lib/server/access-log.ts";
import type { DisclosureItemView, ManifestView } from "../../../../lib/server/disclosures.ts";
import type { GrantView } from "../../../../lib/server/grants.ts";
import cards from "../../_components/confidential/cards.module.css";
import notices from "../../_components/confidential/confidential.module.css";
import {
  ConfidentialProvider,
  useConfidential,
  type AvailableNetwork,
} from "../../_components/confidential/context.tsx";
import { KeysCard, WalletCard } from "../../_components/confidential/keys.tsx";
import { useKeySession } from "../../_components/key-session.tsx";
import { SkyArt } from "../../_components/sky-art.tsx";
import styles from "./keys.module.css";

export type ViewerKeyRecord = {
  userId: string;
  wallet: string;
  publicKey: string;
  signature: string;
};

type Props = {
  wallet: string;
  you: string;
  orgId: string;
  orgName: string;
  ownerWallet: string;
  network: AvailableNetwork;
  grants: GrantView[];
  ownerItems: number;
  events: AccessEventView[];
  ownerKey: ViewerKeyRecord | null;
};

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const shortKey = (key: string) => `${key.slice(0, 4)}…${key.slice(-4)}`;

export function KeysPanel(props: Props) {
  return (
    <ConfidentialProvider
      wallet={props.wallet}
      orgId={props.orgId}
      network={props.network}
      readAccount={false}
    >
      <KeysView {...props} />
    </ConfidentialProvider>
  );
}

function KeysView(props: Props) {
  const { orgId, orgName } = props;
  const [grants, setGrants] = useState(props.grants);
  const [ownerItems, setOwnerItems] = useState(props.ownerItems);
  const [events, setEvents] = useState(props.events);
  const [drawer, setDrawer] = useState(false);
  // The last share's result: the Backfill card closes once no active key misses records, and the
  // result stays in its place.
  const [shared, setShared] = useState<string | null>(null);

  async function refresh() {
    const [listed, log] = await Promise.all([
      callApi<{ grants: GrantView[]; ownerItems: number }>(`/api/orgs/${orgId}/grants`),
      callApi<{ events: AccessEventView[] }>(`/api/orgs/${orgId}/access-log?days=7`),
    ]);
    setGrants(listed.grants);
    setOwnerItems(listed.ownerItems);
    setEvents(log.events);
  }

  const active = grants.filter((grant) => grant.status === "active");
  const waiting = active.filter((grant) => grant.missing > 0);
  return (
    <>
      <PageHeader
        overline="Access"
        title="Viewing keys"
        actions={
          <Button variant="dark" onClick={() => setDrawer(true)} data-testid="open-grant">
            Grant a key
          </Button>
        }
      />
      <div className={styles.page}>
        <Coverage orgName={orgName} grants={active} ownerItems={ownerItems} />
        <KeySky grant={active[0] ?? null} />
        {waiting.length > 0 ? (
          <Backfill
            grants={waiting}
            ownerKey={props.ownerKey}
            ownerWallet={props.ownerWallet}
            you={props.you}
            shared={shared}
            onShared={setShared}
            onDone={refresh}
          />
        ) : shared ? (
          <Card className={styles.s12} data-testid="backfill">
            <h2 className={cards.cardTitle}>Share past records</h2>
            <p className={notices.result} role="status" data-testid="backfill-message">
              {shared}
            </p>
          </Card>
        ) : null}
        <KeysTable grants={grants} onChange={refresh} />
        <AccessLog events={events} you={props.you} />
        <div className={styles.s6}>
          <WalletCard />
        </div>
        <div className={styles.s6}>
          <KeysCard />
        </div>
      </div>
      <GrantDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        onGranted={() => void refresh().catch(() => undefined)}
      />
    </>
  );
}

export function Coverage({
  orgName,
  grants,
  ownerItems,
}: {
  orgName: string;
  grants: GrantView[];
  ownerItems: number;
}) {
  return (
    <Card tone="dark" className={styles.s8} data-testid="coverage">
      <div className={styles.cardHead}>
        <h3>Who can read {orgName}</h3>
        <span className={styles.darkChip}>None of them at Sotto</span>
      </div>
      <p className={styles.darkSub}>
        Share of all amounts each key can open. Everyone else sees payments, never numbers.
      </p>
      {grants.length === 0 ? (
        <p className={styles.darkEmpty}>
          No key is active. Grant one to share records with your accountant.
        </p>
      ) : (
        <div className={styles.coverage}>
          {grants.map((grant) => {
            const share =
              ownerItems > 0 ? Math.min(100, Math.round((grant.items / ownerItems) * 100)) : 0;
            return (
              <div key={grant.id} className={styles.coverRow} data-testid="coverage-row">
                <span className={styles.avatar} aria-hidden="true">
                  {initials(grant.holder.name)}
                </span>
                <div className={styles.coverName}>
                  <b>{grant.holder.name}</b>
                  <small>{scopeWords(grant.scope, grant.periodFrom, grant.periodTo)}</small>
                </div>
                <div className={styles.coverBar}>
                  <span style={{ width: `${share}%` }} />
                </div>
                <span className={`${styles.coverShare} num`} data-testid="coverage-share">
                  {share}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function KeySky({ grant }: { grant: GrantView | null }) {
  const key = grant?.viewer?.viewerKey?.publicKey ?? null;
  return (
    <section className={`${styles.s4} ${styles.sky}`} data-testid="key-sky">
      <SkyArt className={styles.skyArt} />
      <div className={styles.skyText}>
        <h3>Keys stay yours</h3>
        <p>
          Created on your device, encrypted in your browser for the holder only, revoked in one tap.
        </p>
      </div>
      {grant && key ? (
        <div className={styles.keyCard}>
          <div className={styles.keyTop}>
            <span>Viewing key</span>
            <span className={styles.readOnly}>Read only</span>
          </div>
          <div className={styles.keyHolder}>
            <b>{grant.holder.name}</b>
            <small>{scopeWords(grant.scope, grant.periodFrom, grant.periodTo)}</small>
          </div>
          <div className={styles.keyBottom}>
            <span className="mono">{shortKey(key)}</span>
            <span>{expiryWords(grant.expiresAt)}</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Backfill({
  grants,
  ownerKey,
  ownerWallet,
  you,
  shared,
  onShared,
  onDone,
}: {
  grants: GrantView[];
  ownerKey: ViewerKeyRecord | null;
  ownerWallet: string;
  you: string;
  shared: string | null;
  onShared: (text: string | null) => void;
  onDone: () => Promise<void>;
}) {
  const { orgId, wallet, connected, vault } = useConfidential();
  const { session, viewing } = useKeySession();
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const unlocked = viewing?.wallet === wallet;

  async function share(grant: GrantView) {
    const key = grant.viewer?.viewerKey;
    const viewer = grant.viewer;
    if (!connected || !key || !viewer) return;
    setBusy(grant.id);
    setProblem(null);
    onShared(null);
    const release = vault.hold();
    // What was stored, so the result says so even when a later batch stops.
    let count = 0;
    try {
      // I-8: the holder's key is used only after its registration verifies for their wallet.
      const verified = await verifyViewKeyRegistration({
        wallet: viewer.wallet,
        publicKey: fromBase64(key.publicKey),
        signature: fromBase64(key.signature),
      });
      if (!verified) {
        setProblem(
          `${grant.holder.name}'s viewing key does not verify for their wallet, so Sotto does not encrypt to it.`,
        );
        return;
      }
      for (let batch = 0; batch < 20; batch++) {
        const pending = await callApi<{
          items: DisclosureItemView[];
          manifests: ManifestView[];
        }>(`/api/orgs/${orgId}/grants/${grant.id}/backfill`);
        if (pending.items.length === 0) break;
        // I-9: the owner's own records are trusted only after the owner's manifest verifies.
        const opened = await openDisclosures({
          orgId,
          ownerWallet,
          viewerUserId: you,
          items: pending.items,
          manifests: pending.manifests,
          open: (ciphertext) => session.worker().openSealed(ciphertext),
        });
        const items = [];
        for (const record of opened) {
          const source = pending.items.find((item) => item.id === record.id);
          if (record.state !== "opened" || !source || record.payload.subject !== source.subject) {
            continue;
          }
          items.push({
            id: crypto.randomUUID(),
            kind: source.kind,
            subject: source.subject,
            ciphertext: await vault.worker().seal(fromBase64(key.publicKey), record.payload),
          });
        }
        if (items.length === 0) {
          setProblem(
            "The records left to share did not verify against your manifests, so they were not shared.",
          );
          break;
        }
        const manifest = await buildManifest({
          org: orgId,
          createdAt: new Date().toISOString(),
          items: items.map((item) => ({
            id: item.id,
            viewer: viewer.userId,
            ciphertext: item.ciphertext,
          })),
        });
        const signature = await connected.sign(await manifestMessage(manifest));
        if (typeof signature === "string") {
          setProblem(
            withWalletWords(
              count > 0
                ? "Your wallet did not sign the rest of the records, so they were not shared."
                : "Your wallet did not sign the records, so nothing was shared.",
              connected.walletWords(),
            ),
          );
          break;
        }
        await callApi(`/api/orgs/${orgId}/disclosures`, {
          method: "POST",
          body: {
            manifest,
            signature: toBase64(signature),
            items: items.map((item) => ({
              id: item.id,
              viewerUserId: viewer.userId,
              grantId: grant.id,
              kind: item.kind,
              subject: item.subject,
              ciphertext: toBase64(item.ciphertext),
            })),
          },
        });
        count += items.length;
      }
    } catch (error) {
      setProblem(
        error instanceof ApiCallError
          ? error.message
          : count > 0
            ? "The rest of the past records could not be shared."
            : "The past records could not be shared.",
      );
    } finally {
      release();
      setBusy(null);
    }
    if (count > 0) {
      onShared(
        `Shared ${count} past ${count === 1 ? "record" : "records"} with ${grant.holder.name}, encrypted for them only.`,
      );
      // The counts and the coverage follow; this card closes once no active key misses records.
      await onDone().catch(() => undefined);
    }
  }

  return (
    <Card className={styles.s12} data-testid="backfill">
      <h2 className={cards.cardTitle}>Share past records</h2>
      <p className={styles.lead}>
        These keys are active, and some of your records in their scope are not shared with them yet,
        such as the ones from before they were granted. Sharing opens your own records in this tab,
        encrypts each one for the holder only, and asks your wallet to sign the batch. Sotto never
        sees the amounts.
      </p>
      {!ownerKey || !unlocked ? (
        <p className={cards.warning} role="status">
          Unlock your keys below first: your records open with your viewing key in this tab.
        </p>
      ) : null}
      <div className={styles.backfillList}>
        {grants.map((grant) => (
          <div key={grant.id} className={styles.backfillRow} data-testid="backfill-row">
            <Person
              name={grant.holder.name}
              detail={`${grant.missing} ${grant.missing === 1 ? "record" : "records"} in scope`}
              size={36}
            />
            <Button
              variant="blue"
              size="sm"
              disabled={!ownerKey || !unlocked || !connected || busy !== null}
              onClick={() => void share(grant)}
            >
              {busy === grant.id ? "Sharing…" : "Share past records"}
            </Button>
          </div>
        ))}
      </div>
      {shared ? (
        <p className={notices.result} role="status" data-testid="backfill-message">
          {shared}
        </p>
      ) : null}
      {problem ? (
        <p className={cards.problem} role="alert" data-testid="backfill-problem">
          {problem}
        </p>
      ) : null}
    </Card>
  );
}

function KeysTable({ grants, onChange }: { grants: GrantView[]; onChange: () => Promise<void> }) {
  const { orgId } = useConfidential();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [link, setLink] = useState<{ grantId: string; url: string; expiresAt: string } | null>(
    null,
  );
  const [problem, setProblem] = useState<string | null>(null);

  async function revoke(grantId: string) {
    setBusy(grantId);
    setProblem(null);
    try {
      await callApi(`/api/orgs/${orgId}/grants/${grantId}/revoke`, { method: "POST" });
      setConfirming(null);
      await onChange();
    } catch (error) {
      setProblem(error instanceof ApiCallError ? error.message : "The key could not be revoked.");
    } finally {
      setBusy(null);
    }
  }

  async function renew(grantId: string) {
    setBusy(grantId);
    setProblem(null);
    try {
      const { invite } = await callApi<{ invite: { url: string; expiresAt: string } }>(
        `/api/orgs/${orgId}/grants/${grantId}/invite`,
        { method: "POST" },
      );
      setLink({ grantId, ...invite });
      await onChange();
    } catch (error) {
      setProblem(error instanceof ApiCallError ? error.message : "No new link could be made.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className={styles.s8} data-testid="keys-card">
      <div className={cards.head}>
        <h2 className={cards.cardTitle}>Keys</h2>
        <small className={styles.muted}>
          {grants.length} {grants.length === 1 ? "key" : "keys"}
        </small>
      </div>
      {grants.length === 0 ? (
        <p className={styles.empty}>No viewing key yet. Grant a key to share records.</p>
      ) : (
        <div className={styles.scroll}>
          <Table>
            <thead>
              <tr>
                <Th>Holder</Th>
                <Th>Can read</Th>
                <Th>Expires</Th>
                <Th>Last used</Th>
                <Th align="right">Active</Th>
              </tr>
            </thead>
            <tbody>
              {grants.map((grant) => {
                const chip = grantStatusChip(grant.status, grant.invite);
                const live = grant.status === "active" || grant.status === "pending_viewer_key";
                const automatic = grant.scope === "own_payslips";
                return (
                  <tr
                    key={grant.id}
                    className={live ? undefined : styles.revoked}
                    data-testid="key-row"
                    data-status={grant.status}
                  >
                    <Td>
                      <Person
                        name={grant.holder.name}
                        detail={grant.holder.title ?? (automatic ? "Recipient" : "")}
                        size={38}
                      />
                    </Td>
                    <Td>
                      <Chip tone={grant.scope === "own_payslips" ? "neutral" : "blue"}>
                        {scopeWords(grant.scope, grant.periodFrom, grant.periodTo)}
                      </Chip>
                    </Td>
                    <Td className="num">{expiryWords(grant.expiresAt)}</Td>
                    <Td className={styles.muted}>{lastUsedWords(grant.lastUsedAt)}</Td>
                    <Td align="right" className={styles.keyEnd}>
                      <div className={styles.rowEnd}>
                        <Chip tone={chip.tone} data-testid="key-status">
                          {chip.label}
                        </Chip>
                        {automatic ? (
                          <small className={styles.muted}>Automatic</small>
                        ) : (
                          <button
                            type="button"
                            className={`${styles.toggle} ${live ? "" : styles.off}`}
                            aria-pressed={live}
                            aria-label={`Revoke ${grant.holder.name}'s key`}
                            disabled={!live || busy !== null}
                            onClick={() => setConfirming(grant.id)}
                            data-testid="key-toggle"
                          />
                        )}
                      </div>
                      {grant.invite && grant.invite.status !== "accepted" && live ? (
                        <Button
                          variant="line"
                          size="sm"
                          disabled={busy !== null}
                          onClick={() => void renew(grant.id)}
                        >
                          New invite link
                        </Button>
                      ) : null}
                      {confirming === grant.id ? (
                        <div
                          className={styles.confirm}
                          role="alertdialog"
                          aria-label={`Revoke ${grant.holder.name}'s key`}
                          data-testid="revoke-confirm"
                        >
                          <p className={`${cards.warning} ${styles.confirmText}`}>{REVOKE_COPY}</p>
                          <div className={styles.confirmActions}>
                            <Button
                              variant="line"
                              size="sm"
                              onClick={() => setConfirming(null)}
                              disabled={busy !== null}
                            >
                              Keep
                            </Button>
                            <Button
                              variant="dark"
                              size="sm"
                              onClick={() => void revoke(grant.id)}
                              disabled={busy !== null}
                              data-testid="confirm-revoke"
                            >
                              {busy === grant.id ? "Revoking…" : "Revoke"}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                      {link?.grantId === grant.id ? (
                        <InviteLink url={link.url} expiresAt={link.expiresAt} />
                      ) : null}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}
      {problem ? (
        <p className={cards.problem} role="alert">
          {problem}
        </p>
      ) : null}
    </Card>
  );
}

/**
 * Whose initials an access log entry shows: the actor's display name, else, when someone other than
 * the owner acted on a key, the holder the event names; null for a person glyph.
 */
function avatarName(event: AccessEventView, you: string): string | null {
  if (!event.actor) return null;
  if (event.actor.displayName) return event.actor.displayName;
  if (event.actor.userId !== you && event.subject.type === "grant") return event.subject.label;
  return null;
}

function AccessLog({ events, you }: { events: AccessEventView[]; you: string }) {
  return (
    <Card className={styles.s4} data-testid="access-log">
      <div className={cards.head}>
        <h2 className={cards.cardTitle}>Access log</h2>
        <small className={styles.muted}>7 days</small>
      </div>
      {events.length === 0 ? (
        <p className={styles.empty}>Nothing happened in the last 7 days.</p>
      ) : (
        <div className={styles.log}>
          {events.map((event) => {
            const words = eventWords(event, you);
            return (
              <div
                key={event.id}
                className={styles.logEntry}
                data-testid="log-entry"
                data-action={event.action}
              >
                {/* Who acted (design .le avatars, as initials); the Sotto mark for the worker. */}
                <span className={styles.logAvatar} aria-hidden="true">
                  {event.actor === null ? (
                    <svg width="14" height="14" viewBox="0 0 26 26">
                      <circle
                        cx="13"
                        cy="13"
                        r="10.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.6"
                      />
                      <path d="M13 2.5a10.5 10.5 0 000 21z" fill="currentColor" />
                    </svg>
                  ) : avatarName(event, you) ? (
                    initials(avatarName(event, you) ?? "")
                  ) : (
                    <svg
                      width="15"
                      height="15"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <circle cx="12" cy="8" r="3.5" />
                      <path d="M5 20c.9-3.6 3.6-5.5 7-5.5s6.1 1.9 7 5.5" />
                    </svg>
                  )}
                </span>
                <div>
                  <b>{words.title}</b>
                  <small>
                    {words.detail ? `${words.detail}, ` : ""}
                    {whenWords(event.createdAt)}
                  </small>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function InviteLink({ url, expiresAt }: { url: string; expiresAt: string }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  return (
    <div className={styles.link} data-testid="grant-invite">
      <Field
        label="Invite link, shown once"
        htmlFor={`${id}-link`}
        hint={`Valid until ${formatDate(expiresAt)}. Send it to the holder yourself.`}
      >
        <div className={styles.linkField}>
          {/* Two lines, so the whole link shows in the drawer's width. */}
          <textarea
            id={`${id}-link`}
            className={styles.linkText}
            readOnly
            rows={2}
            value={url}
            data-testid="grant-invite-link"
            onFocus={(event) => event.currentTarget.select()}
          />
          <Button
            variant="line"
            size="sm"
            onClick={() => {
              void navigator.clipboard?.writeText(url).then(() => setCopied(true));
            }}
          >
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </Field>
    </div>
  );
}

function GrantDrawer({
  open,
  onClose,
  onGranted,
}: {
  open: boolean;
  onClose: () => void;
  onGranted: () => void;
}) {
  const { orgId } = useConfidential();
  const id = useId();
  const quarter = currentQuarter();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState<"all_payments" | "period" | "payroll_only">("all_payments");
  const [from, setFrom] = useState(quarter.from);
  const [to, setTo] = useState(quarter.to);
  const [expiry, setExpiry] = useState<GrantExpiryChoiceName>("end_of_quarter");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    url: string;
    expiresAt: string;
    holder: string;
    reads: string;
    until: string;
  } | null>(null);

  function close() {
    setCreated(null);
    setProblem(null);
    onClose();
  }

  async function grant() {
    if (name.trim() === "") {
      setProblem("Enter the holder's name.");
      return;
    }
    if (scope === "period" && from > to) {
      setProblem("The period ends on or after the day it starts.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const response = await callApi<{ invite: { url: string; expiresAt: string } }>(
        `/api/orgs/${orgId}/grants`,
        {
          method: "POST",
          body: {
            holderName: name.trim(),
            ...(title.trim() ? { holderTitle: title.trim() } : {}),
            scope,
            ...(scope === "period" ? { periodFrom: from, periodTo: to } : {}),
            expiry,
          },
        },
      );
      setCreated({
        ...response.invite,
        holder: name.trim(),
        reads: scopeWords(scope, scope === "period" ? from : null, scope === "period" ? to : null),
        until: expiryWords(previewExpiry(expiry)),
      });
      setName("");
      setTitle("");
      onGranted();
    } catch (error) {
      setProblem(error instanceof ApiCallError ? error.message : "The key could not be granted.");
    } finally {
      setBusy(false);
    }
  }

  const reads = scopeWords(scope, scope === "period" ? from : null, scope === "period" ? to : null);
  return (
    <Drawer
      open={open}
      title="Grant a viewing key"
      subtitle="Read access only. Never control of funds."
      onClose={close}
      footer={
        created ? (
          <Button variant="dark" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="line" onClick={close}>
              Cancel
            </Button>
            <Button
              variant="blue"
              onClick={() => void grant()}
              disabled={busy}
              data-testid="grant-key"
            >
              {busy ? "Granting…" : "Grant key"}
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className={styles.drawerBody}>
          <div className={styles.fieldLabel}>Granted</div>
          <div className={styles.preview}>
            <div>
              <span>Holder</span>
              <span>{created.holder}</span>
              <Chip tone="amber">Invite sent</Chip>
            </div>
            <div>
              <span>Reads</span>
              <span>{created.reads}</span>
              <Chip tone="blue">Sealed for others</Chip>
            </div>
            <div>
              <span>Until</span>
              <span>{created.until}</span>
              <span />
            </div>
          </div>
          <p className={notices.info}>
            The key waits for its holder. They open the link, sign in with their wallet, accept and
            create their viewing key; then share your past records with them here.
          </p>
          <InviteLink url={created.url} expiresAt={created.expiresAt} />
        </div>
      ) : (
        <div className={styles.drawerBody}>
          <div className={styles.fieldLabel}>Who</div>
          <div className={styles.twoFields}>
            <Field label="Name" htmlFor={`${id}-name`}>
              <Input
                id={`${id}-name`}
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Field label="Role, optional" htmlFor={`${id}-title`}>
              <Input
                id={`${id}-title`}
                value={title}
                maxLength={80}
                placeholder="Accountant, external"
                onChange={(event) => setTitle(event.target.value)}
              />
            </Field>
          </div>
          <div className={styles.fieldLabel}>Can read</div>
          <div className={styles.pick}>
            {GRANT_SCOPE_CHOICES.map((choice) => (
              <button
                key={choice.scope}
                type="button"
                className={choice.scope === scope ? styles.picked : undefined}
                aria-pressed={choice.scope === scope}
                onClick={() => setScope(choice.scope)}
              >
                {choice.label}
              </button>
            ))}
          </div>
          {scope === "period" ? (
            <div className={styles.twoFields}>
              <Field label="From" htmlFor={`${id}-from`}>
                <Input
                  id={`${id}-from`}
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </Field>
              <Field label="To, included" htmlFor={`${id}-to`}>
                <Input
                  id={`${id}-to`}
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </Field>
            </div>
          ) : null}
          <div className={styles.fieldLabel}>Expires</div>
          <div className={styles.pick}>
            {GRANT_EXPIRY_CHOICES.map((choice) => (
              <button
                key={choice.expiry}
                type="button"
                className={choice.expiry === expiry ? styles.picked : undefined}
                aria-pressed={choice.expiry === expiry}
                onClick={() => setExpiry(choice.expiry)}
              >
                {choice.label}
              </button>
            ))}
          </div>
          <div className={styles.fieldLabel}>Preview</div>
          <div className={styles.preview} data-testid="grant-preview">
            <div>
              <span>Holder</span>
              <span>{name.trim() || "Not named yet"}</span>
              <span />
            </div>
            <div>
              <span>Reads</span>
              <span>{reads}</span>
              <Chip tone="blue">Sealed for others</Chip>
            </div>
            <div>
              <span>Until</span>
              <span>{expiryWords(previewExpiry(expiry))}</span>
              <span />
            </div>
          </div>
          {problem ? (
            <p className={cards.problem} role="alert">
              {problem}
            </p>
          ) : null}
        </div>
      )}
    </Drawer>
  );
}
