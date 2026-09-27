CREATE TYPE "public"."approval_kind" AS ENUM('message', 'execution');--> statement-breakpoint
CREATE TYPE "public"."approval_subject_type" AS ENUM('payment', 'payroll_run');--> statement-breakpoint
CREATE TYPE "public"."cluster_name" AS ENUM('localnet', 'devnet', 'mainnet');--> statement-breakpoint
CREATE TYPE "public"."disclosure_kind" AS ENUM('payment', 'payroll_line', 'month_total', 'balance_snapshot');--> statement-breakpoint
CREATE TYPE "public"."grant_scope" AS ENUM('all_payments', 'period', 'payroll_only', 'own_payslips');--> statement-breakpoint
CREATE TYPE "public"."grant_status" AS ENUM('pending_viewer_key', 'active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."key_scheme" AS ENUM('standard_v1', 'sotto_ikm_v1');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'approver', 'accountant', 'board', 'recipient');--> statement-breakpoint
CREATE TYPE "public"."org_status" AS ENUM('pending_review', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."payment_attempt_status" AS ENUM('sent', 'confirmed', 'finalized', 'failed', 'failed_clean');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('single', 'payroll_line');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('draft', 'authorized', 'executing', 'settled', 'failed_clean', 'failed');--> statement-breakpoint
CREATE TYPE "public"."recipient_readiness" AS ENUM('no_account', 'not_configured', 'ready');--> statement-breakpoint
CREATE TYPE "public"."screening_result" AS ENUM('clear', 'hit', 'error');--> statement-breakpoint
CREATE TYPE "public"."viewer_key_status" AS ENUM('active', 'rotated');--> statement-breakpoint
CREATE TABLE "admins" (
	"wallet" text PRIMARY KEY NOT NULL,
	CONSTRAINT "admins_wallet_base58" CHECK ("admins"."wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"subject_type" "approval_subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"approver_user_id" uuid NOT NULL,
	"kind" "approval_kind" DEFAULT 'message' NOT NULL,
	"message" text,
	"signature" "bytea",
	"execution_signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approvals_subject_approver_key" UNIQUE("subject_type","subject_id","approver_user_id"),
	CONSTRAINT "approvals_kind_fields" CHECK (("approvals"."kind" = 'message' and "approvals"."message" is not null and "approvals"."signature" is not null) or ("approvals"."kind" = 'execution' and "approvals"."execution_signature" is not null)),
	CONSTRAINT "approvals_signature_length" CHECK ("approvals"."signature" is null or octet_length("approvals"."signature") = 64)
);
--> statement-breakpoint
CREATE TABLE "auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "auth_nonces_wallet_base58" CHECK ("auth_nonces"."wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
);
--> statement-breakpoint
CREATE TABLE "disclosures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"grant_id" uuid,
	"viewer_user_id" uuid NOT NULL,
	"kind" "disclosure_kind" NOT NULL,
	"subject" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"manifest_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"viewer_user_id" uuid,
	"invite_token" text NOT NULL,
	"scope" "grant_scope" NOT NULL,
	"period_from" date,
	"period_to" date,
	"expires_at" timestamp with time zone,
	"status" "grant_status" DEFAULT 'pending_viewer_key' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "grants_period_bounds" CHECK ("grants"."scope" <> 'period' or ("grants"."period_from" is not null and "grants"."period_to" is not null and "grants"."period_from" <= "grants"."period_to"))
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"token" text PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by" uuid,
	"accepted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"signer_wallet" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"signature" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manifests_signer_wallet_base58" CHECK ("manifests"."signer_wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "manifests_signature_length" CHECK (octet_length("manifests"."signature") = 64)
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "memberships_org_user_role_key" UNIQUE("org_id","user_id","role")
);
--> statement-breakpoint
CREATE TABLE "org_policy" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"payment_approvals_required" integer DEFAULT 1 NOT NULL,
	"payroll_approvals_required" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "org_policy_payment_approvals_min" CHECK ("org_policy"."payment_approvals_required" >= 1),
	CONSTRAINT "org_policy_payroll_approvals_min" CHECK ("org_policy"."payroll_approvals_required" >= 1)
);
--> statement-breakpoint
CREATE TABLE "orgs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"legal_name" text NOT NULL,
	"country" char(2) NOT NULL,
	"registration_no" text NOT NULL,
	"website" text NOT NULL,
	"contact_email" text NOT NULL,
	"status" "org_status" DEFAULT 'pending_review' NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"attestation_address" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"private_blob" "bytea",
	CONSTRAINT "orgs_country_iso" CHECK ("orgs"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "orgs_attestation_address_base58" CHECK ("orgs"."attestation_address" is null or "orgs"."attestation_address" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "orgs_reviewed_by_base58" CHECK ("orgs"."reviewed_by" is null or "orgs"."reviewed_by" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"signatures" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" "payment_attempt_status" NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attempts_payment_attempt_key" UNIQUE("payment_id","attempt_no"),
	CONSTRAINT "payment_attempts_attempt_no_min" CHECK ("payment_attempts"."attempt_no" >= 1)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"run_id" uuid,
	"recipient_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "payment_status" DEFAULT 'draft' NOT NULL,
	"signatures" text[] DEFAULT '{}'::text[] NOT NULL,
	"settled_slot" bigint,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"role_title" text,
	"team" text,
	"country" char(2),
	"wallet" text NOT NULL,
	"user_id" uuid,
	"readiness" "recipient_readiness" DEFAULT 'no_account' NOT NULL,
	"readiness_checked_at" timestamp with time zone,
	"private_blob" "bytea",
	CONSTRAINT "recipients_org_wallet_key" UNIQUE("org_id","wallet"),
	CONSTRAINT "recipients_wallet_base58" CHECK ("recipients"."wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "recipients_country_iso" CHECK ("recipients"."country" is null or "recipients"."country" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "screenings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"provider" text NOT NULL,
	"result" "screening_result" NOT NULL,
	"provider_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "screenings_wallet_base58" CHECK ("screenings"."wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "token_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"org_id" uuid,
	"cluster" "cluster_name" NOT NULL,
	"address" text NOT NULL,
	"mint" text NOT NULL,
	"key_scheme" "key_scheme" NOT NULL,
	"configured_slot" bigint,
	CONSTRAINT "token_accounts_cluster_address_key" UNIQUE("cluster","address"),
	CONSTRAINT "token_accounts_address_base58" CHECK ("token_accounts"."address" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "token_accounts_mint_base58" CHECK ("token_accounts"."mint" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_wallet_unique" UNIQUE("wallet"),
	CONSTRAINT "users_wallet_base58" CHECK ("users"."wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$')
);
--> statement-breakpoint
CREATE TABLE "viewer_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"public_key" "bytea" NOT NULL,
	"registration_signature" "bytea" NOT NULL,
	"status" "viewer_key_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "viewer_keys_public_key_length" CHECK (octet_length("viewer_keys"."public_key") = 32),
	CONSTRAINT "viewer_keys_registration_signature_length" CHECK (octet_length("viewer_keys"."registration_signature") = 64)
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosures" ADD CONSTRAINT "disclosures_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosures" ADD CONSTRAINT "disclosures_grant_id_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosures" ADD CONSTRAINT "disclosures_viewer_user_id_users_id_fk" FOREIGN KEY ("viewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disclosures" ADD CONSTRAINT "disclosures_manifest_id_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."manifests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_viewer_user_id_users_id_fk" FOREIGN KEY ("viewer_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_invite_token_invites_token_fk" FOREIGN KEY ("invite_token") REFERENCES "public"."invites"("token") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grants" ADD CONSTRAINT "grants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_accepted_by_users_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_policy" ADD CONSTRAINT "org_policy_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_recipient_id_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."recipients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipients" ADD CONSTRAINT "recipients_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipients" ADD CONSTRAINT "recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "screenings" ADD CONSTRAINT "screenings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_accounts" ADD CONSTRAINT "token_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_accounts" ADD CONSTRAINT "token_accounts_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viewer_keys" ADD CONSTRAINT "viewer_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disclosures_viewer_org_idx" ON "disclosures" USING btree ("viewer_user_id","org_id");--> statement-breakpoint
CREATE INDEX "disclosures_grant_id_idx" ON "disclosures" USING btree ("grant_id");--> statement-breakpoint
CREATE INDEX "grants_org_id_idx" ON "grants" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "grants_viewer_user_id_idx" ON "grants" USING btree ("viewer_user_id");--> statement-breakpoint
CREATE INDEX "invites_org_id_idx" ON "invites" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "manifests_org_id_idx" ON "manifests" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orgs_owner_user_id_idx" ON "orgs" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "orgs_status_idx" ON "orgs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_org_id_idx" ON "payments" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "payments_recipient_id_idx" ON "payments" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "screenings_org_wallet_created_idx" ON "screenings" USING btree ("org_id","wallet","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "token_accounts_user_id_idx" ON "token_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "viewer_keys_one_active_per_user" ON "viewer_keys" USING btree ("user_id") WHERE "viewer_keys"."status" = 'active';