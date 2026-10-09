"use client";

// The onboarding screen's client part: the organization form (create, and edit while in review) and
// the status card. The form validates with the same schema as the API (lib/org.ts). No approved
// design exists for this screen; it is built on the app tokens. Step 3.4 (design pass A,
// founder 2026-10-01): the shared fields of packages/ui beside the three steps of verification, and the
// status as a tracker of those steps with the attestation as the last. Step 4.3 (D-29): where the
// network has more than one asset, the form asks which one the account holds (USDC by default); the
// choice is fixed once the organization exists. Step 4.6 (D-30): on devnet a new organization is
// verified at once, with no review, and the form, the steps and the status say so.
import {
  Button,
  Card,
  Chip,
  Field as UiField,
  FieldActions,
  FieldGrid,
  Input,
  PageHeader,
  Select,
  type ChipTone,
} from "@sotto/ui";
import Link from "next/link";
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
  type OrgVerification,
} from "../../../lib/org.ts";
import { assetWords } from "../../../lib/asset-words.ts";
import type { AssetView } from "../../../lib/server/network-view.ts";
import { DevnetTestBadge } from "../_components/devnet-badge.tsx";
import styles from "./onboarding.module.css";
import { DEFAULT_ASSET, isAssetId, type AssetId } from "@sotto/sdk/cluster/assets";

export type OnboardingOrg = {
  id: string;
  displayName: string;
  legalName: string;
  country: string;
  registrationNo: string;
  website: string;
  contactEmail: string;
  status: OrgStatus;
  asset: AssetId;
  attestationAddress: string | null;
  reviewedAt: string | null;
  /** How it was verified or refused; null while in review (D-30). */
  verification: OrgVerification | null;
  createdAt: string;
};

type FieldName =
  "legalName" | "displayName" | "country" | "registrationNo" | "website" | "contactEmail" | "asset";

type Values = Record<FieldName, string>;

const EMPTY: Values = {
  legalName: "",
  displayName: "",
  country: "",
  registrationNo: "",
  website: "",
  contactEmail: "",
  asset: DEFAULT_ASSET,
};

const FIELD_NAMES = new Set<string>(Object.keys(EMPTY));

const STATUS_TONE: Record<OrgStatus, ChipTone> = {
  pending_review: "amber",
  active: "green",
  suspended: "red",
};

export function OrgOnboarding({
  org,
  assets,
  verification,
}: {
  org: OnboardingOrg | null;
  /** The network's registry (step 4.3): the assets an account may hold, USDC first. */
  assets: AssetView[];
  /** How this network verifies a new organization (D-30): automatically on devnet. */
  verification: OrgVerification;
}) {
  const [editing, setEditing] = useState(false);
  if (!org) {
    return (
      <>
        <PageHeader overline="Get started" title="Your organization" />
        <div className={styles.grid}>
          <OrgForm assets={assets} verification={verification} />
          <HowItWorks verification={verification} />
        </div>
      </>
    );
  }
  if (editing && org.status === "pending_review") {
    return (
      <>
        <PageHeader overline="Change details" title={org.displayName} />
        <div className={styles.grid}>
          <OrgForm
            org={org}
            assets={assets}
            verification="review"
            onDone={() => setEditing(false)}
          />
          <HowItWorks verification="review" />
        </div>
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
    asset: org.asset,
  };
}

function OrgForm({
  org,
  assets,
  verification,
  onDone,
}: {
  org?: OnboardingOrg;
  assets: AssetView[];
  verification: OrgVerification;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(() => valuesOf(org));
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [refreshing, startRefresh] = useTransition();
  const busy = sending || refreshing;
  const chosen = assetWords(isAssetId(values.asset) ? values.asset : DEFAULT_ASSET);

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
      ...(org ? {} : { asset: values.asset }),
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
      <p className={styles.lead} data-testid="form-lead">
        {verification === "automatic"
          ? "On devnet Sotto verifies a new organization at once, without reviewing these details, so you can try it with test money. The legal name, country, registration number and website cannot be changed afterwards."
          : "A Sotto admin reviews these details before money features open."}
      </p>
      <form onSubmit={submit} noValidate aria-busy={busy}>
        <FieldGrid>
          <Field label="Legal name" error={errors.legalName} wide>
            {(props) => (
              <Input
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
              <Input
                {...props}
                name="displayName"
                value={values.displayName}
                onChange={change("displayName")}
              />
            )}
          </Field>
          <Field label="Country" error={errors.country}>
            {(props) => (
              <Select
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
              </Select>
            )}
          </Field>
          <Field label="Registration number" error={errors.registrationNo}>
            {(props) => (
              <Input
                {...props}
                name="registrationNo"
                value={values.registrationNo}
                onChange={change("registrationNo")}
              />
            )}
          </Field>
          <Field label="Website" error={errors.website}>
            {(props) => (
              <Input
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
              <Input
                {...props}
                name="contactEmail"
                type="email"
                autoComplete="email"
                value={values.contactEmail}
                onChange={change("contactEmail")}
              />
            )}
          </Field>
          {!org && assets.length > 1 ? (
            <Field
              label="Currency"
              hint="The account holds and pays in this currency. It cannot be changed later."
              error={errors.asset}
              wide
            >
              {(props) => (
                <Select {...props} name="asset" value={values.asset} onChange={change("asset")}>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.symbol === asset.displayName
                        ? asset.symbol
                        : `${asset.symbol}, ${asset.displayName}`}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          {!org && chosen.devnetTestAsset ? (
            <p className={`${styles.assetNote} ${styles.wide}`} data-testid="asset-note">
              <DevnetTestBadge asset={chosen} />
              {chosen.symbol} has no value: it lets you try Sotto with realistic amounts. Your
              wallet can get some from the faucet on the setup page.
            </p>
          ) : null}
          {formError ? (
            <p className={`${styles.formError} ${styles.wide}`} role="alert">
              {formError}
            </p>
          ) : null}
          <FieldActions>
            <Button type="submit" variant="blue" disabled={busy}>
              {busy
                ? "Sending…"
                : org
                  ? "Save changes"
                  : verification === "automatic"
                    ? "Create organization"
                    : "Send for review"}
            </Button>
            {org && onDone ? (
              <Button variant="line" onClick={onDone} disabled={busy}>
                Cancel
              </Button>
            ) : null}
          </FieldActions>
        </FieldGrid>
      </form>
    </Card>
  );
}

type ControlProps = {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby"?: string;
};

/** A shared field whose hint and problem the control names in aria-describedby. */
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
    <UiField label={label} htmlFor={id} hint={hint} error={error} wide={wide ?? false}>
      {children({
        id,
        "aria-invalid": Boolean(error),
        ...(described ? { "aria-describedby": described } : {}),
      })}
    </UiField>
  );
}

/** The three steps of verification, beside the form. */
function HowItWorks({ verification }: { verification: OrgVerification }) {
  const automatic = verification === "automatic";
  return (
    <Card className={styles.how} data-testid="how-verification-works">
      <h2 className={styles.cardTitle}>How verification works</h2>
      <ol className={styles.steps}>
        <li>
          <span className={styles.stepNo} aria-hidden="true">
            01
          </span>
          <div>
            <b>{automatic ? "Enter your business details" : "Send your business details"}</b>
            <small>Legal name, country, registration number, website and a contact email.</small>
          </div>
        </li>
        <li>
          <span className={styles.stepNo} aria-hidden="true">
            02
          </span>
          <div>
            <b>{automatic ? "Verified at once on devnet" : "A Sotto admin reviews them"}</b>
            <small>
              {automatic
                ? "Nobody reviews the details on devnet. Money features open as soon as the organization exists."
                : "Money features stay off until the review verifies the organization."}
            </small>
          </div>
        </li>
        <li>
          <span className={styles.stepNo} aria-hidden="true">
            03
          </span>
          <div>
            <b>An attestation onchain</b>
            <small>
              {automatic
                ? "Sotto issues an attestation onchain to your wallet with the organization ID, legal name, country, verification date and a review level that says no review took place. Anyone can read it."
                : "Once verified, Sotto issues an attestation onchain to your wallet with the organization ID, legal name, country, verification date and review level. Anyone can read it."}
            </small>
          </div>
        </li>
      </ol>
    </Card>
  );
}

type Stage = { title: string; detail: string; state: "done" | "current" | "next" | "stopped" };

/** The status as the three steps of verification. */
export function stagesOf(org: OnboardingOrg): Stage[] {
  // D-30: verified automatically on devnet, so no review is named.
  if (org.status === "active" && org.verification === "automatic") {
    return [
      { title: "Created", detail: formatDate(org.createdAt), state: "done" },
      { title: "Verified automatically", detail: "On devnet, without a review", state: "done" },
      org.attestationAddress
        ? { title: "Attestation onchain", detail: "Issued to your wallet", state: "done" }
        : { title: "Attestation onchain", detail: "Being issued", state: "current" },
    ];
  }
  const sent: Stage = {
    title: "Sent for review",
    detail: formatDate(org.createdAt),
    state: "done",
  };
  if (org.status === "pending_review") {
    return [
      sent,
      { title: "Reviewed by Sotto", detail: "In review", state: "current" },
      { title: "Attestation onchain", detail: "After the review", state: "next" },
    ];
  }
  if (org.status === "suspended") {
    return [
      sent,
      {
        title: "Reviewed by Sotto",
        detail: org.reviewedAt ? `Not verified, ${formatDate(org.reviewedAt)}` : "Not verified",
        state: "stopped",
      },
      { title: "Attestation onchain", detail: "None", state: "next" },
    ];
  }
  return [
    sent,
    {
      title: "Reviewed by Sotto",
      detail: org.reviewedAt ? `Verified, ${formatDate(org.reviewedAt)}` : "Verified",
      state: "done",
    },
    org.attestationAddress
      ? { title: "Attestation onchain", detail: "Issued to your wallet", state: "done" }
      : { title: "Attestation onchain", detail: "Being issued", state: "current" },
  ];
}

function Tracker({ org }: { org: OnboardingOrg }) {
  return (
    <ol className={styles.tracker} data-testid="verification-tracker">
      {stagesOf(org).map((stage) => (
        <li key={stage.title} className={styles[stage.state]} data-state={stage.state}>
          <span className={styles.dot} aria-hidden="true" />
          <b>{stage.title}</b>
          <small>{stage.detail}</small>
        </li>
      ))}
    </ol>
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
        <Tracker org={org} />
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
              {org.verification === "automatic"
                ? "Verified automatically on devnet, without a review. The attestation onchain, issued to your wallet, says so."
                : "Verified by Sotto. The verification is an attestation onchain, issued to your wallet."}
            </p>
            <dl className={styles.details}>
              <dt>Attestation</dt>
              <dd className="mono" data-testid="attestation-address">
                {org.attestationAddress}
              </dd>
            </dl>
            <div className={styles.actions}>
              <Link className={styles.primaryLink} href={`/app/${org.id}/setup`}>
                Set up the confidential account
              </Link>
            </div>
          </>
        ) : null}
        {org.status === "active" && !org.attestationAddress ? (
          <>
            <p className={styles.lead}>
              {org.verification === "automatic"
                ? "Verified automatically on devnet, without a review. Money features are open. The attestation is being issued to your wallet onchain; reload in a moment to see its address."
                : "Verified by Sotto. The attestation is being issued to your wallet onchain; reload in a moment to see its address."}
            </p>
            <div className={styles.actions}>
              <Link className={styles.primaryLink} href={`/app/${org.id}/setup`}>
                Set up the confidential account
              </Link>
            </div>
          </>
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
          <dt>Currency</dt>
          <dd data-testid="org-asset">
            {assetWords(org.asset).symbol} <DevnetTestBadge asset={assetWords(org.asset)} />
          </dd>
          <dt>{org.verification === "automatic" ? "Created" : "Sent for review"}</dt>
          <dd>{formatDate(org.createdAt)}</dd>
          {org.reviewedAt && org.verification !== "automatic" ? (
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
