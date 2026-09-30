CREATE TABLE "proof_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"cluster" "cluster_name" NOT NULL,
	"record_address" text NOT NULL,
	"threshold_base_units" bigint NOT NULL,
	"counterparty_label" text NOT NULL,
	"counterparty_salt" "bytea" NOT NULL,
	"expiry" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proof_records_record_address_unique" UNIQUE("record_address"),
	CONSTRAINT "proof_records_record_address_base58" CHECK ("proof_records"."record_address" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "proof_records_salt_16_bytes" CHECK (octet_length("proof_records"."counterparty_salt") = 16),
	CONSTRAINT "proof_records_threshold_positive" CHECK ("proof_records"."threshold_base_units" > 0),
	CONSTRAINT "proof_records_label_length" CHECK (char_length("proof_records"."counterparty_label") between 1 and 120)
);
--> statement-breakpoint
ALTER TABLE "proof_records" ADD CONSTRAINT "proof_records_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proof_records_org_created_idx" ON "proof_records" USING btree ("org_id","created_at");