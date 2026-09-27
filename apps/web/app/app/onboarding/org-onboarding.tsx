"use client";

// The onboarding screen's client part: the organization form (create, and edit while in review) and
// the status card. The form validates with the same schema as the API (lib/org.ts). No approved
// design exists for this screen; it is built on the app tokens (13 A35).
import { Button, Card, Chip, PageHeader, type ChipTone } from "@sotto/ui";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { ApiCallError, callApi, invalidField } from "../../../lib/client/api.ts";
import { COUNTRIES, countryName } from "../../../lib/countries.ts";
import { formatDate } from "../../../lib/format.ts";
import {
  normalizeWebsite,
  orgCreateSchema,
  orgStatusLabel,
  type OrgStatus,
} from "../../../lib/org.ts";
import styles from "./onboarding.module.css";

export type OnboardingOrg = {
  id: string;
  displayName: string;
  legalName: string;
  country: string;
  registrationNo: string;
  website: string;
  contactEmail: string;
  status: OrgStatus;
  attestationAddress: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

type FieldName =
  "legalName" | "displayName" | "country" | "registrationNo" | "website" | "contactEmail";

type Values = Record<FieldName, string>;

const EMPTY: Values = {
  legalName: "",
  displayName: "",
  country: "",
  registrationNo: "",
  website: "",
  contactEmail: "",
};

const FIELD_NAMES = new Set<string>(Object.keys(EMPTY));

const STATUS_TONE: Record<OrgStatus, ChipTone> = {
  pending_review: "amber",
  active: "green",
  suspended: "red",
};

export function OrgOnboarding({ org }: { org: OnboardingOrg | null }) {
  const [editing, setEditing] = useState(false);
  if (!org) {
    return (
      <>
        <PageHeader overline="Get started" title="Your organization" />
        <OrgForm />
      </>
    );
  }
  if (editing && org.status === "pending_review") {
    return (
      <>
        <PageHeader overline="Change details" title={org.displayName} />
        <OrgForm org={org} onDone={() => setEditing(false)} />
      </>
    );
  }
  return (
    <>
      <PageHeader overline="Your organization" title={org.displayName} />
      <OrgStatusView org={org} onEdit={() => setEditing(true)} />
    </>
  );
}

function valuesOf(org: OnboardingOrg | undefined): Values {
  if (!org) return EMPTY;
  return {
    legalName: org.legalName,
    displayName: org.displayName === org.legalName ? "" : org.displayName,
    country: org.country,
    registrationNo: org.registrationNo,
    website: org.website,
    contactEmail: org.contactEmail,
  };
}

function OrgForm({ org, onDone }: { org?: OnboardingOrg; onDone?: () => void }) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(() => valuesOf(org));
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const busy = sending || refreshing;

  const change = (name: FieldName) => (event: { target: { value: string } }) => {
    const { value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    const parsed = orgCreateSchema.safeParse({
      legalName: values.legalName,
      ...(values.displayName.trim() ? { displayName: values.displayName } : {}),
      country: values.country,
      registrationNo: values.registrationNo,
      website: normalizeWebsite(values.website),
      contactEmail: values.contactEmail.trim(),
    });
    if (!parsed.success) {
      const next: Partial<Record<FieldName, string>> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (typeof field === "string" && FIELD_NAMES.has(field) && !next[field as FieldName]) {
          next[field as FieldName] = issue.message;
        }
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSending(true);
    try {
      if (org) {
        // An emptied display name goes back to the legal name, as at creation.
        await callApi(`/api/orgs/${org.id}`, {
          method: "PATCH",
          body: { ...parsed.data, displayName: parsed.data.displayName ?? parsed.data.legalName },
        });
        onDone?.();
      } else {
        await callApi("/api/orgs", { method: "POST", body: parsed.data });
      }
      startRefresh(() => router.refresh());
    } catch (error) {
      const field = error instanceof ApiCallError ? invalidField(error) : null;
      if (field && FIELD_NAMES.has(field.field)) {
        setErrors({ [field.field]: field.message });
      } else {
        setFormError(
          error instanceof ApiCallError ? error.message : "Something went wrong. Try again.",
        );
        // A review that finished meanwhile changes what the page shows.
        if (error instanceof ApiCallError && error.status === 409) {
          startRefresh(() => router.refresh());
        }
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className={styles.formCard}>
      <h2 className={styles.cardTitle}>Business details</h2>
      <p className={styles.lead}>
        A Sotto admin reviews these details before money features open. Once verified, Sotto issues
        an attestation onchain to your wallet with the organization ID, legal name, country,
        verification date and review level. Anyone can read it.
      </p>
      <form className={styles.form} onSubmit={submit} noValidate aria-busy={busy}>
        <Field label="Legal name" error={errors.legalName} wide>
          {(props) => (
            <input
              {...props}
              name="legalName"
              autoComplete="organization"
              value={values.legalName}
              onChange={change("legalName")}
            />
          )}
        </Field>
        <Field
          label="Display name"
          hint="Optional. Shown in Sotto instead of the legal name."
          error={errors.displayName}
        >
          {(props) => (
            <input
              {...props}
              name="displayName"
              value={values.displayName}
              onChange={change("displayName")}
            />
          )}
        </Field>
        <Field label="Country" error={errors.country}>
          {(props) => (
            <select
              {...props}
              name="country"
              autoComplete="country"
              value={values.country}
              onChange={change("country")}
            >
              <option value="" disabled>
                Choose a country
              </option>
              {COUNTRIES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Registration number" error={errors.registrationNo}>
          {(props) => (
            <input
              {...props}
              name="registrationNo"
              value={values.registrationNo}
              onChange={change("registrationNo")}
            />
          )}
        </Field>
        <Field label="Website" error={errors.website}>
          {(props) => (
            <input
              {...props}
              name="website"
              inputMode="url"
              autoComplete="url"
              placeholder="example.com"
              value={values.website}
              onChange={change("website")}
            />
          )}
        </Field>
        <Field label="Contact email" error={errors.contactEmail}>
          {(props) => (
            <input
              {...props}
              name="contactEmail"
              type="email"
              autoComplete="email"
              value={values.contactEmail}
              onChange={change("contactEmail")}
            />
          )}
        </Field>
        {formError ? (
          <p className={styles.formError} role="alert">
            {formError}
          </p>
        ) : null}
        <div className={styles.actions}>
          <Button type="submit" variant="blue" disabled={busy}>
            {busy ? "Sending…" : org ? "Save changes" : "Send for review"}
          </Button>
          {org && onDone ? (
            <Button variant="line" onClick={onDone} disabled={busy}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

type ControlProps = {
  id: string;
  className: string | undefined;
  "aria-invalid": boolean;
  "aria-describedby"?: string;
};

function Field({
  label,
  hint,
  error,
  wide,
  children,
}: {
  label: string;
  hint?: string;
  error: string | undefined;
  wide?: boolean;
  children: (props: ControlProps) => ReactNode;
}) {
  const id = useId();
  const described = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={wide ? `${styles.field} ${styles.wide}` : styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        className: styles.control,
        "aria-invalid": Boolean(error),
        ...(described ? { "aria-describedby": described } : {}),
      })}
      {hint ? (
        <small id={`${id}-hint`} className={styles.hint}>
          {hint}
        </small>
      ) : null}
      {error ? (
        <small id={`${id}-error`} className={styles.error}>
          {error}
        </small>
      ) : null}
    </div>
  );
}

function OrgStatusView({ org, onEdit }: { org: OnboardingOrg; onEdit: () => void }) {
  return (
    <div className={styles.grid}>
      <Card>
        <div className={styles.statusHead}>
          <h2 className={styles.cardTitle}>Verification</h2>
          <Chip tone={STATUS_TONE[org.status]} data-testid="org-status">
            {orgStatusLabel(org.status)}
          </Chip>
        </div>
        {org.status === "pending_review" ? (
          <>
            <p className={styles.lead}>
              A Sotto admin is reviewing the business details. Money features open once Sotto
              verifies the organization.
            </p>
            <div className={styles.actions}>
              <Button variant="line" size="sm" onClick={onEdit}>
                Change details
              </Button>
            </div>
          </>
        ) : null}
        {org.status === "active" && org.attestationAddress ? (
          <>
            <p className={styles.lead}>
              Verified by Sotto. The verification is an attestation onchain, issued to your wallet.
            </p>
            <dl className={styles.details}>
              <dt>Attestation</dt>
              <dd className="mono" data-testid="attestation-address">
                {org.attestationAddress}
              </dd>
            </dl>
          </>
        ) : null}
        {org.status === "active" && !org.attestationAddress ? (
          <p className={styles.lead}>
            Verified by Sotto. The attestation is being issued to your wallet onchain; reload in a
            moment to see its address.
          </p>
        ) : null}
        {org.status === "suspended" ? (
          <p className={styles.lead}>
            Sotto has not verified this organization, so money features are off.
          </p>
        ) : null}
      </Card>
      <Card>
        <h2 className={styles.cardTitle}>Business details</h2>
        <dl className={styles.details}>
          <dt>Legal name</dt>
          <dd>{org.legalName}</dd>
          <dt>Country</dt>
          <dd>{countryName(org.country)}</dd>
          <dt>Registration number</dt>
          <dd>{org.registrationNo}</dd>
          <dt>Website</dt>
          <dd>
            <a href={org.website} target="_blank" rel="noopener noreferrer">
              {org.website}
            </a>
          </dd>
          <dt>Contact email</dt>
          <dd>{org.contactEmail}</dd>
          <dt>Sent for review</dt>
          <dd>{formatDate(org.createdAt)}</dd>
          {org.reviewedAt ? (
            <>
              <dt>Reviewed</dt>
              <dd>{formatDate(org.reviewedAt)}</dd>
            </>
          ) : null}
        </dl>
      </Card>
    </div>
  );
}
