CREATE TYPE "public"."chain_activity_type" AS ENUM('account_setup', 'deposit', 'apply_pending', 'transfer_out', 'transfer_in', 'withdraw', 'wrap', 'unwrap', 'public_transfer_out', 'public_transfer_in');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_status" AS ENUM('matched', 'needs_receipt');--> statement-breakpoint
CREATE TABLE "chain_activity" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "chain_activity_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"org_id" uuid NOT NULL,
	"token_account" text NOT NULL,
	"signature" text NOT NULL,
	"slot" bigint NOT NULL,
	"block_time" timestamp with time zone,
	"instruction_index" integer NOT NULL,
	"instruction_type" "chain_activity_type" NOT NULL,
	"counterparty_address" text,
	"public_amount_base_units" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chain_activity_instruction_key" UNIQUE("org_id","token_account","signature","instruction_index"),
	CONSTRAINT "chain_activity_token_account_base58" CHECK ("chain_activity"."token_account" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "chain_activity_counterparty_base58" CHECK ("chain_activity"."counterparty_address" is null or "chain_activity"."counterparty_address" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "chain_activity_signature_base58" CHECK ("chain_activity"."signature" ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$'),
	CONSTRAINT "chain_activity_instruction_index" CHECK ("chain_activity"."instruction_index" >= 0),
	CONSTRAINT "chain_activity_public_amount" CHECK (("chain_activity"."instruction_type" in ('deposit', 'withdraw')) = ("chain_activity"."public_amount_base_units" is not null) and ("chain_activity"."public_amount_base_units" is null or "chain_activity"."public_amount_base_units" >= 0))
);
--> statement-breakpoint
CREATE TABLE "reconciliations" (
	"payment_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"status" "reconciliation_status" NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "token_accounts" ADD COLUMN "indexed_until" text;--> statement-breakpoint
ALTER TABLE "token_accounts" ADD COLUMN "indexed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chain_activity" ADD CONSTRAINT "chain_activity_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chain_activity_org_slot_idx" ON "chain_activity" USING btree ("org_id","slot");--> statement-breakpoint
CREATE INDEX "chain_activity_signature_idx" ON "chain_activity" USING btree ("signature");