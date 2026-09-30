"use client";

// The admin console's client part: status filters, the organization table and the review actions.
// Every action asks for a second click to confirm. No approved design exists for this screen; it is
// built on the app tokens (13 A35), and since design pass C (step 3.6) in the design's language: each
// business with its mark, the card head with the count, and the empty state of the other pages.
import { Button, Card, Chip, PageHeader, Person, Table, Td, Th, type ChipTone } from "@sotto/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ApiCallError, callApi } from "../../../lib/client/api.ts";
import { countryName } from "../../../lib/countries.ts";
import { formatDate, shortWallet } from "../../../lib/format.ts";
import type { OrgStatus } from "../../../lib/org.ts";
import styles from "./admin.module.css";
import { FILTERS, type Filter } from "./filters.ts";

const FILTER_LABEL: Record<Filter, string> = {
  pending_review: "In review",
  active: "Active",
  suspended: "Suspended",
  all: "All",
};

const STATUS: Record<OrgStatus, { label: string; tone: ChipTone }> = {
  pending_review: { label: "In review", tone: "amber" },
  active: { label: "Active", tone: "green" },
  suspended: { label: "Suspended", tone: "red" },
};

type Action = "approve" | "reject" | "suspend";

const ACTION_LABEL: Record<Action, string> = {
  approve: "Approve",
  reject: "Reject",
  suspend: "Suspend",
};

export type AdminOrg = {
  id: string;
  displayName: string;
  legalName: string;
  country: string;
  registrationNo: string;
  website: string;
  contactEmail: string;
  status: OrgStatus;
  ownerWallet: string;
  attestationAddress: string | null;
  createdAt: string;
};

export function AdminConsole({
  orgs,
  filter,
  truncated,
}: {
  orgs: readonly AdminOrg[];
  filter: Filter;
  truncated: boolean;
}) {
  return (
    <>
      <PageHeader overline="Sotto admin" title="Business review" />
      <nav className={styles.filters} aria-label="Filter by status">
        {FILTERS.map((item) => (
          <Link
            key={item}
            href={`/app/admin?status=${item}`}
            className={item === filter ? `${styles.filter} ${styles.current}` : styles.filter}
            {...(item === filter ? { "aria-current": "page" as const } : {})}
          >
            {FILTER_LABEL[item]}
          </Link>
        ))}
      </nav>
      <Card>
        <div className={styles.head}>
          <h2 className={styles.title}>Organizations</h2>
          <small className={styles.count}>
            {orgs.length === 1 ? "1 organization" : `${orgs.length} organizations`}
          </small>
        </div>
        {orgs.length === 0 ? (
          <p className={styles.empty}>
            {filter === "pending_review"
              ? "No organization is waiting for review."
              : "No organizations here."}
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Organization</Th>
                <Th>Country</Th>
                <Th>Registration</Th>
                <Th>Contact</Th>
                <Th>Owner wallet</Th>
                <Th>Sent</Th>
                <Th>Status</Th>
                <Th>Attestation</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <OrgRow key={org.id} org={org} />
              ))}
            </tbody>
          </Table>
        )}
        {truncated ? (
          <p className={styles.note}>Showing the oldest {orgs.length}. Filter to see the rest.</p>
        ) : null}
      </Card>
    </>
  );
}

function attestationText(org: AdminOrg): string {
  if (org.attestationAddress) {
    return org.status === "suspended" ? "Closing…" : shortWallet(org.attestationAddress);
  }
  return org.status === "active" ? "Issuing…" : "None";
}

function OrgRow({ org }: { org: AdminOrg }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const busy = sending || refreshing;
  const actions: Action[] =
    org.status === "pending_review"
      ? ["approve", "reject"]
      : org.status === "active"
        ? ["suspend"]
        : [];

  async function run(action: Action) {
    setSending(true);
    setError(null);
    try {
      await callApi(`/api/admin/orgs/${org.id}/${action}`, { method: "POST" });
      setConfirming(null);
    } catch (caught) {
      setError(
        caught instanceof ApiCallError ? caught.message : "Something went wrong. Try again.",
      );
    } finally {
      setSending(false);
      startRefresh(() => router.refresh());
    }
  }

  return (
    <tr data-testid="admin-org-row">
      <Td>
        <Person
          name={org.displayName}
          business
          size={38}
          detail={
            <>
              {org.legalName} ·{" "}
              <a href={org.website} target="_blank" rel="noopener noreferrer">
                {org.website.replace(/^https?:\/\//, "")}
              </a>
            </>
          }
        />
      </Td>
      <Td>{countryName(org.country)}</Td>
      <Td>{org.registrationNo}</Td>
      <Td>{org.contactEmail}</Td>
      <Td>
        <span className="mono" title={org.ownerWallet}>
          {shortWallet(org.ownerWallet)}
        </span>
      </Td>
      <Td>{formatDate(org.createdAt)}</Td>
      <Td>
        <Chip tone={STATUS[org.status].tone}>{STATUS[org.status].label}</Chip>
      </Td>
      <Td>
        <span
          className={org.attestationAddress ? "mono" : styles.none}
          title={org.attestationAddress ?? undefined}
        >
          {attestationText(org)}
        </span>
      </Td>
      <Td align="right">
        <div className={styles.rowActions}>
          {confirming ? (
            <>
              <Button
                size="sm"
                variant={confirming === "approve" ? "blue" : "dark"}
                disabled={busy}
                onClick={() => run(confirming)}
              >
                {busy ? "Saving…" : `Confirm ${ACTION_LABEL[confirming].toLowerCase()}`}
              </Button>
              <Button size="sm" variant="line" disabled={busy} onClick={() => setConfirming(null)}>
                Cancel
              </Button>
            </>
          ) : (
            actions.map((action) => (
              <Button
                key={action}
                size="sm"
                variant={action === "approve" ? "blue" : "line"}
                disabled={busy}
                onClick={() => setConfirming(action)}
              >
                {ACTION_LABEL[action]}
              </Button>
            ))
          )}
        </div>
        {error ? (
          <small className={styles.rowError} role="alert">
            {error}
          </small>
        ) : null}
      </Td>
    </tr>
  );
}
