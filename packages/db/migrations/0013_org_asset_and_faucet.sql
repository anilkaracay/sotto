CREATE TYPE "public"."asset_id" AS ENUM('usdc', 'devusd');--> statement-breakpoint
CREATE TYPE "public"."faucet_mint_status" AS ENUM('pending', 'sent', 'minted', 'failed');--> statement-breakpoint
CREATE TABLE "faucet_mints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"amount_base_units" bigint NOT NULL,
	"status" "faucet_mint_status" DEFAULT 'pending' NOT NULL,
	"signature" text,
	"last_valid_block_height" bigint,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "faucet_mints_wallet_base58" CHECK ("faucet_mints"."wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "faucet_mints_amount_positive" CHECK ("faucet_mints"."amount_base_units" > 0)
);
--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "asset" "asset_id" DEFAULT 'usdc' NOT NULL;--> statement-breakpoint
ALTER TABLE "faucet_mints" ADD CONSTRAINT "faucet_mints_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "faucet_mints_wallet_time" ON "faucet_mints" USING btree ("wallet","created_at");--> statement-breakpoint
CREATE INDEX "faucet_mints_status" ON "faucet_mints" USING btree ("status");