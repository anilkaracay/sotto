// Phase 1 tables of the logical schema in docs/08-BACKEND.md section 2, plus rate_limits (08 section
// 6), since step 2.3 payroll_runs with the payments.run_id foreign key, since step 2.4 access_log, and
// since step 2.5 chain_activity and reconciliations. Golden rule (08 section 1): no plaintext amount,
// balance or key material in any column; amounts exist only as ciphertext (private_blob,
// disclosures.ciphertext), except the amounts that are public onchain (ENGINEERING-RULES.md rule 4).
// test/golden-rule.test.ts checks the column names. Later steps add proof_records and waitlist.
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
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
export const payrollRunStatus = pgEnum("payroll_run_status", [
  "draft",
  "awaiting_approval",
  "approved",
  "executing",
  "settled",
  "partially_settled",
  "failed",
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
/** Step 2.5 (08 section 4): what an instruction did to an org's token account, public data only. */
export const chainActivityType = pgEnum("chain_activity_type", [
  "account_setup",
  "deposit",
  "apply_pending",
  "transfer_out",
  "transfer_in",
  "withdraw",
  "wrap",
  "unwrap",
  "public_transfer_out",
  "public_transfer_in",
]);
/** Step 2.5 (AC-11.3): reconciliation status only; notes are Post-hackathon (D-27). */
export const reconciliationStatus = pgEnum("reconciliation_status", ["matched", "needs_receipt"]);

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
    /**
     * Step 2.5: the index-accounts job's cursor, the newest finalized transaction of the account it has
     * read (08 section 4), and when it last read the account.
     */
    indexedUntil: text("indexed_until"),
    indexedAt: timestamptz("indexed_at"),
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

/**
 * Step 2.3 (F-08): a payroll run. Its lines are payments of kind payroll_line; the run holds no
 * amount, each line's amount is in its own private blob. `status` follows AC-08.2.
 */
export const payrollRuns = pgTable(
  "payroll_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    title: text("title").notNull(),
    /** The pay period, YYYY-MM. */
    period: char("period", { length: 7 }).notNull(),
    /** A client made uuid per run the owner means to create: the same key returns the same run. */
    idempotencyKey: text("idempotency_key").notNull().unique(),
    status: payrollRunStatus("status").notNull().default("draft"),
    lineCount: integer("line_count").notNull(),
    /** The initiator: running the payroll is their approval (Q-11, 13 A31). */
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    /** When the first line was sent. */
    executedAt: timestamptz("executed_at"),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("payroll_runs_period_format", sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("payroll_runs_line_count_min", sql`${t.lineCount} >= 1`),
    index("payroll_runs_org_id_idx").on(t.orgId),
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
    /** Step 2.3: the run of a payroll line, null for a single payment. */
    runId: uuid("run_id").references((): AnyPgColumn => payrollRuns.id),
    /** Step 2.3: a payroll line's place in its run, from 1; lines are paid in this order. */
    lineNo: integer("line_no"),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => recipients.id),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    /** Step 1.9: the member who created the payment; their execution counts as an approval (Q-11). */
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    /**
     * Step 1.9: the amount and memo, sealed in the owner's browser to the owner's viewing key (07
     * section 2); its SHA-256 is part of the approval contents (D-04). Since step 2.3 each payroll
     * line has its own, with the gross and tax columns of the CSV when given.
     */
    privateBlob: bytea("private_blob"),
    status: paymentStatus("status").notNull().default("draft"),
    signatures: text("signatures")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    settledSlot: bigint("settled_slot", { mode: "bigint" }),
    errorCode: text("error_code"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
    updatedAt: timestamptz("updated_at").notNull().defaultNow(),
    /**
     * Step 2.4: when the worker settled the payment (finality); a period grant covers the payments
     * settled in its period (07 section 6).
     */
    settledAt: timestamptz("settled_at"),
  },
  (t) => [
    index("payments_org_id_idx").on(t.orgId),
    index("payments_recipient_id_idx").on(t.recipientId),
    index("payments_run_id_idx").on(t.runId),
    unique("payments_run_line_key").on(t.runId, t.lineNo),
    check(
      "payments_kind_run",
      sql`(${t.kind} = 'payroll_line' and ${t.runId} is not null and ${t.lineNo} is not null and ${t.lineNo} >= 1) or (${t.kind} = 'single' and ${t.runId} is null and ${t.lineNo} is null)`,
    ),
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
    /**
     * Step 1.9: the signature of the attempt's transaction that holds the transfer instruction; the
     * confirm-executions job settles the payment when it is finalized.
     */
    transferSignature: text("transfer_signature"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("payment_attempts_payment_attempt_key").on(t.paymentId, t.attemptNo),
    check("payment_attempts_attempt_no_min", sql`${t.attemptNo} >= 1`),
  ],
);

/**
 * Step 1.9 (F-19, AC-19.1): the worker's proof-program-health job records per cluster whether the ZK
 * ElGamal Proof program verified a simulated proof; payment authorization needs a recent success.
 */
export const clusterHealth = pgTable("cluster_health", {
  cluster: clusterName("cluster").primaryKey(),
  proofProgramOk: boolean("proof_program_ok").notNull(),
  /** Why the check failed (the simulation error), never secrets. */
  detail: text("detail"),
  checkedAt: timestamptz("checked_at").notNull(),
});

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
    /** Step 2.4: the holder as the owner named them in the invite (a recipient's grant has none). */
    holderName: text("holder_name"),
    holderTitle: text("holder_title"),
    /** Step 2.4: when the grant became active (the viewer accepted with a viewing key). */
    activatedAt: timestamptz("activated_at"),
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
 * Step 2.4 (F-14, AC-14.1): what happened in an org, metadata only, never an amount: grants, back
 * fills and disclosure batches, payments and payroll runs, approvals. `metadata` holds ids, counts,
 * scopes and dates (the writers check its keys against the golden rule).
 */
export const accessLog = pgTable(
  "access_log",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    /** Null for the worker (an expiry, a settlement). */
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    metadata: jsonb("metadata")
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("access_log_action_format", sql`${t.action} ~ '^[a-z][a-z_]{2,63}$'`),
    index("access_log_org_created_idx").on(t.orgId, t.createdAt),
  ],
);

/**
 * Step 2.5 (08 section 4, AC-05.3): the public activity of an org's token accounts, one row per
 * instruction of a finalized transaction that touched one: who, when, which instruction and the other
 * account. The only amounts are those public onchain, a confidential deposit's or withdrawal's
 * (ENGINEERING-RULES.md rule 4); the check refuses any other.
 */
export const chainActivity = pgTable(
  "chain_activity",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    tokenAccount: text("token_account").notNull(),
    signature: text("signature").notNull(),
    slot: bigint("slot", { mode: "bigint" }).notNull(),
    blockTime: timestamptz("block_time"),
    instructionIndex: integer("instruction_index").notNull(),
    instructionType: chainActivityType("instruction_type").notNull(),
    counterpartyAddress: text("counterparty_address"),
    publicAmountBaseUnits: bigint("public_amount_base_units", { mode: "bigint" }),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("chain_activity_instruction_key").on(
      t.orgId,
      t.tokenAccount,
      t.signature,
      t.instructionIndex,
    ),
    check(
      "chain_activity_token_account_base58",
      sql`${t.tokenAccount} ~ ${sql.raw(`'${BASE58_ADDRESS}'`)}`,
    ),
    check(
      "chain_activity_counterparty_base58",
      sql`${t.counterpartyAddress} is null or ${t.counterpartyAddress} ~ ${sql.raw(`'${BASE58_ADDRESS}'`)}`,
    ),
    check("chain_activity_signature_base58", sql`${t.signature} ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'`),
    check("chain_activity_instruction_index", sql`${t.instructionIndex} >= 0`),
    check(
      "chain_activity_public_amount",
      sql`(${t.instructionType} in ('deposit', 'withdraw')) = (${t.publicAmountBaseUnits} is not null) and (${t.publicAmountBaseUnits} is null or ${t.publicAmountBaseUnits} >= 0)`,
    ),
    index("chain_activity_org_slot_idx").on(t.orgId, t.slot),
    index("chain_activity_signature_idx").on(t.signature),
  ],
);

/** Step 2.5 (AC-11.3): a payment's reconciliation status, set by a reader of its record; no notes. */
export const reconciliations = pgTable("reconciliations", {
  paymentId: uuid("payment_id")
    .primaryKey()
    .references(() => payments.id),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  status: reconciliationStatus("status").notNull(),
  updatedBy: uuid("updated_by")
    .notNull()
    .references(() => users.id),
  updatedAt: timestamptz("updated_at").notNull().defaultNow(),
});

/**
 * Fixed window rate limit counters (08 section 6), shared by every server instance. `key` is an HMAC
 * of the limited subject (session or IP), never the raw value (apps/web/lib/server/rate-limit.ts).
 */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamptz("window_start").notNull(),
  count: integer("count").notNull(),
});
