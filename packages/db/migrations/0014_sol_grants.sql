CREATE TYPE "public"."sol_grant_status" AS ENUM('pending', 'sent', 'paid', 'failed');--> statement-breakpoint
CREATE TABLE "sol_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"lamports" bigint NOT NULL,
	"status" "sol_grant_status" DEFAULT 'pending' NOT NULL,
	"signature" text,
	"last_valid_block_height" bigint,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sol_grants_wallet_base58" CHECK ("sol_grants"."wallet" ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
	CONSTRAINT "sol_grants_lamports_positive" CHECK ("sol_grants"."lamports" > 0)
);
--> statement-breakpoint
ALTER TABLE "sol_grants" ADD CONSTRAINT "sol_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sol_grants_wallet_time" ON "sol_grants" USING btree ("wallet","created_at");--> statement-breakpoint
CREATE INDEX "sol_grants_status" ON "sol_grants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sol_grants_time" ON "sol_grants" USING btree ("created_at");