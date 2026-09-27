// Phase 1 tables of the logical schema in docs/08-BACKEND.md section 2, plus rate_limits (08 section
// 6). Golden rule (08 section 1): no plaintext amount, balance or key material in any column; amounts
// exist only as ciphertext (private_blob, disclosures.ciphertext). test/golden-rule.test.ts checks the
// column names. Later phases add payroll_runs (and the payments.run_id foreign key), proof_records,
// reconciliations, access_log, waitlist and chain_activity.
import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { bytea, timestamptz } from "./columns.ts";

/** Base58 Solana address: 32 to 44 characters of the Bitcoin alphabet. */
const BASE58_ADDRESS = "^[1-9A-HJ-NP-Za-km-z]{32,44}$";

export const orgStatus = pgEnum("org_status", ["pending_review", "active", "suspended"]);
export const membershipRole = pgEnum("membership_role", [
  "owner",
  "approver",
  "accountant",
  "board",
  "recipient",
]);
export const viewerKeyStatus = pgEnum("viewer_key_status", ["active", "rotated"]);
export const clusterName = pgEnum("cluster_name", ["localnet", "devnet", "mainnet"]);
export const keyScheme = pgEnum("key_scheme", ["standard_v1", "sotto_ikm_v1"]);
export const recipientReadiness = pgEnum("recipient_readiness", [
  "no_account",
  "not_configured",
  "ready",
]);
export const screeningResult = pgEnum("screening_result", ["clear", "hit", "error"]);
export const paymentKind = pgEnum("payment_kind", ["single", "payroll_line"]);
export const paymentStatus = pgEnum("payment_status", [
  "draft",
  "authorized",
  "executing",
  "settled",
  "failed_clean",
  "failed",
]);
export const paymentAttemptStatus = pgEnum("payment_attempt_status", [
  "sent",
  "confirmed",
  "finalized",
  "failed",
  "failed_clean",
]);
export const approvalSubjectType = pgEnum("approval_subject_type", ["payment", "payroll_run"]);
export const approvalKind = pgEnum("approval_kind", ["message", "execution"]);
export const grantScope = pgEnum("grant_scope", [
  "all_payments",
  "period",
  "payroll_only",
  "own_payslips",
]);
export const grantStatus = pgEnum("grant_status", [
  "pending_viewer_key",
  "active",
  "revoked",
  "expired",
]);
export const disclosureKind = pgEnum("disclosure_kind", [
  "payment",
  "payroll_line",
  "month_total",
  "balance_snapshot",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wallet: text("wallet").notNull().unique(),
    displayName: text("display_name"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [check("users_wallet_base58", sql`${t.wallet} ~ ${sql.raw(`'${BASE58_ADDRESS}'`)}`)],
);

export const authNonces = pgTable(
  "auth_nonces",
  {
    nonce: text("nonce").primaryKey(),
    wallet: text("wallet").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    usedAt: timestamptz("used_at"),
  },
  (t) => [check("auth_nonces_wallet_base58", sql`${t.wallet} ~ ${sql.raw(`'${BASE58_ADDRESS}'`)}`)],
);

/** `id` is the HMAC of the opaque cookie token (apps/web/lib/server/session.ts), never the token. */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
    expiresAt: timestamptz("expires_at").notNull(),
    revokedAt: timestamptz("revoked_at"),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

/** Source of truth for Sotto admins; ADMIN_WALLETS only seeds it (X-53). */
export const admins = pgTable(
  "admins",
  {
    wallet: text("wallet").primaryKey(),
  },
  (t) => [check("admins_wallet_base58", sql`${t.wallet} ~ ${sql.raw(`'${BASE58_ADDRESS}'`)}`)],
);

export const orgs = pgTable(
  "orgs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    displayName: text("display_name").notNull(),
    legalName: text("legal_name").notNull(),
    country: char("country", { length: 2 }).notNull(),
    registrationNo: text("registration_no").notNull(),
    website: text("website").notNull(),
    contactEmail: text("contact_email").notNull(),
    status: orgStatus("status").notNull().default("pending_review"),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    attestationAddress: text("attestation_address"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamptz("reviewed_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    /** Encrypted to the owner's own key: budgets and settings with amounts. */
    privateBlob: bytea("private_blob"),
  },
  (t) => [
    check("orgs_country_iso", sql`${t.country} ~ '^[A-Z]{2}$'`),
    check(
      "orgs_attestation_address_base58",
      sql`${t.attestationAddress} is null or ${t.attestationAddress} ~ ${sql.raw(`'${BASE58_ADDRESS}'`)}`,
    ),
    check(
      "orgs_reviewed_by_base58",
      sql`${t.reviewedBy} is null or ${t.reviewedBy} ~ ${sql.raw(`'${BASE58_ADDRESS}'`)}`,
    ),
    // One org per owner wallet: the attestation nonce is the owner's wallet (08 section 5), so a wallet
    // can carry only one verified business.
    uniqueIndex("orgs_owner_user_id_key").on(t.ownerUserId),
    index("orgs_status_idx").on(t.status),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: membershipRole("role").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    removedAt: timestamptz("removed_at"),
  },
  (t) => [
    unique("memberships_org_user_role_key").on(t.orgId, t.userId, t.role),
    index("memberships_user_id_idx").on(t.userId),
  ],
);

export const invites = pgTable(
  "invites",
  {
    /** The SHA-256 of the invite token in lowercase hex; the token itself is only in the link. */
    token: text("token").primaryKey(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    role: membershipRole("role").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    expiresAt: timestamptz("expires_at").notNull(),
    acceptedBy: uuid("accepted_by").references(() => users.id),
    acceptedAt: timestamptz("accepted_at"),
    /**
     * Step 1.8: the recipient a recipient invite is for; the accepting wallet must be the recipient's
     * wallet. Null for other roles.
     */
    recipientId: uuid("recipient_id").references((): AnyPgColumn => recipients.id, {
      onDelete: "cascade",
    }),
  },
  (t) => [
    index("invites_org_id_idx").on(t.orgId),
    index("invites_recipient_id_idx").on(t.recipientId),
    check("invites_token_sha256", sql`${t.token} ~ '^[0-9a-f]{64}$'`),
    check(
      "invites_recipient_role",
      sql`(${t.role} = 'recipient') = (${t.recipientId} is not null)`,
    ),
  ],
);

export const orgPolicy = pgTable(
  "org_policy",
  {
    orgId: uuid("org_id")
      .primaryKey()
      .references(() => orgs.id),
    paymentApprovalsRequired: integer("payment_approvals_required").notNull().default(1),
    payrollApprovalsRequired: integer("payroll_approvals_required").notNull().default(1),
  },
  (t) => [
    check("org_policy_payment_approvals_min", sql`${t.paymentApprovalsRequired} >= 1`),
    check("org_policy_payroll_approvals_min", sql`${t.payrollApprovalsRequired} >= 1`),
  ],
);

export const viewerKeys = pgTable(
  "viewer_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    /** X25519 public key (32 bytes). */
    publicKey: bytea("public_key").notNull(),
    /** Ed25519 signature of the registration message by the user's wallet (64 bytes, I-8). */
    registrationSignature: bytea("registration_signature").notNull(),
    status: viewerKeyStatus("status").notNull().default("active"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("viewer_keys_public_key_length", sql`octet_length(${t.publicKey}) = 32`),
    check(
      "viewer_keys_registration_signature_length",
      sql`octet_length(${t.registrationSignature}) = 64`,
    ),
    uniqueIndex("viewer_keys_one_active_per_user")
      .on(t.userId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export const tokenAccounts = pgTable(
  "token_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    orgId: uuid("org_id").references(() => orgs.id),
    cluster: clusterName("cluster").notNull(),
    address: text("address").notNull(),
    mint: text("mint").notNull(),
    keyScheme: keyScheme("key_scheme").notNull(),
    configuredSlot: bigint("configured_slot", { mode: "bigint" }),
    /**
     * Set by the worker's pending-credits job while the account's pending balance credit counter is at
     * or above 80 percent of its maximum (AC-04.3); the app then prompts the owner to apply on the next
     * unlock. Cleared when the counter is below again.
     */
    applyFlaggedAt: timestamptz("apply_flagged_at"),
  },
  (t) => [
    unique("token_accounts_cluster_address_key").on(t.cluster, t.address),
    check("token_accounts_address_base58", sql`${t.address} ~ ${sql.raw(`'${BASE58_ADDRESS}'`)}`),
    check("token_accounts_mint_base58", sql`${t.mint} ~ ${sql.raw(`'${BASE58_ADDRESS}'`)}`),
    index("token_accounts_user_id_idx").on(t.userId),
  ],
);

export const recipients = pgTable(
  "recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    displayName: text("display_name").notNull(),
    roleTitle: text("role_title"),
    team: text("team"),
    country: char("country", { length: 2 }),
    wallet: text("wallet").notNull(),
    userId: uuid("user_id").references(() => users.id),
    readiness: recipientReadiness("readiness").notNull().default("no_account"),
    readinessCheckedAt: timestamptz("readiness_checked_at"),
    /** Encrypted to the owner's own key: default amount and notes. */
    privateBlob: bytea("private_blob"),
  },
  (t) => [
    unique("recipients_org_wallet_key").on(t.orgId, t.wallet),
    check("recipients_wallet_base58", sql`${t.wallet} ~ ${sql.raw(`'${BASE58_ADDRESS}'`)}`),
    check("recipients_country_iso", sql`${t.country} is null or ${t.country} ~ '^[A-Z]{2}$'`),
  ],
);

export const screenings = pgTable(
  "screenings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    wallet: text("wallet").notNull(),
    provider: text("provider").notNull(),
    result: screeningResult("result").notNull(),
    providerRef: text("provider_ref"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("screenings_wallet_base58", sql`${t.wallet} ~ ${sql.raw(`'${BASE58_ADDRESS}'`)}`),
    index("screenings_org_wallet_created_idx").on(t.orgId, t.wallet, t.createdAt),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    kind: paymentKind("kind").notNull(),
    /** payroll_runs arrives in Phase 2, which adds the foreign key. */
    runId: uuid("run_id"),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => recipients.id),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: paymentStatus("status").notNull().default("draft"),
    signatures: text("signatures")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    settledSlot: bigint("settled_slot", { mode: "bigint" }),
    errorCode: text("error_code"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("payments_org_id_idx").on(t.orgId),
    index("payments_recipient_id_idx").on(t.recipientId),
  ],
);

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    attemptNo: integer("attempt_no").notNull(),
    signatures: text("signatures")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: paymentAttemptStatus("status").notNull(),
    errorCode: text("error_code"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("payment_attempts_payment_attempt_key").on(t.paymentId, t.attemptNo),
    check("payment_attempts_attempt_no_min", sql`${t.attemptNo} >= 1`),
  ],
);

/** Q-11: kind message needs the signed message; kind execution needs the execution signature. */
export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    subjectType: approvalSubjectType("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    approverUserId: uuid("approver_user_id")
      .notNull()
      .references(() => users.id),
    kind: approvalKind("kind").notNull().default("message"),
    message: text("message"),
    signature: bytea("signature"),
    executionSignature: text("execution_signature"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("approvals_subject_approver_key").on(t.subjectType, t.subjectId, t.approverUserId),
    check(
      "approvals_kind_fields",
      sql`(${t.kind} = 'message' and ${t.message} is not null and ${t.signature} is not null) or (${t.kind} = 'execution' and ${t.executionSignature} is not null)`,
    ),
    check(
      "approvals_signature_length",
      sql`${t.signature} is null or octet_length(${t.signature}) = 64`,
    ),
  ],
);

/** Always created through an invite; viewer_user_id is null until the invite is accepted (08). */
export const grants = pgTable(
  "grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    viewerUserId: uuid("viewer_user_id").references(() => users.id),
    inviteToken: text("invite_token")
      .notNull()
      .references(() => invites.token),
    scope: grantScope("scope").notNull(),
    periodFrom: date("period_from", { mode: "string" }),
    periodTo: date("period_to", { mode: "string" }),
    expiresAt: timestamptz("expires_at"),
    status: grantStatus("status").notNull().default("pending_viewer_key"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    revokedAt: timestamptz("revoked_at"),
    lastUsedAt: timestamptz("last_used_at"),
  },
  (t) => [
    check(
      "grants_period_bounds",
      sql`${t.scope} <> 'period' or (${t.periodFrom} is not null and ${t.periodTo} is not null and ${t.periodFrom} <= ${t.periodTo})`,
    ),
    index("grants_org_id_idx").on(t.orgId),
    index("grants_viewer_user_id_idx").on(t.viewerUserId),
  ],
);

export const manifests = pgTable(
  "manifests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    signerWallet: text("signer_wallet").notNull(),
    manifest: jsonb("manifest").notNull(),
    /** Ed25519 signature of the canonical manifest by the owner wallet (64 bytes, I-9). */
    signature: bytea("signature").notNull(),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "manifests_signer_wallet_base58",
      sql`${t.signerWallet} ~ ${sql.raw(`'${BASE58_ADDRESS}'`)}`,
    ),
    check("manifests_signature_length", sql`octet_length(${t.signature}) = 64`),
    index("manifests_org_id_idx").on(t.orgId),
  ],
);

export const disclosures = pgTable(
  "disclosures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    grantId: uuid("grant_id").references(() => grants.id),
    viewerUserId: uuid("viewer_user_id")
      .notNull()
      .references(() => users.id),
    kind: disclosureKind("kind").notNull(),
    subject: text("subject").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    manifestId: uuid("manifest_id")
      .notNull()
      .references(() => manifests.id),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("disclosures_viewer_org_idx").on(t.viewerUserId, t.orgId),
    index("disclosures_grant_id_idx").on(t.grantId),
  ],
);

/**
 * Fixed window rate limit counters (08 section 6), shared by every server instance. `key` is an HMAC
 * of the limited subject (session or IP), never the raw value (apps/web/lib/server/rate-limit.ts).
 */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamptz("window_start").notNull(),
  count: integer("count").notNull(),
});
